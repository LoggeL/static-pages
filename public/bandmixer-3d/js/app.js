import { StemAudioEngine } from './audio-engine.js';
import { LanesUI } from './lanes-ui.js';
import { QrModal } from './qr-modal.js';

function hexToRgbString(hex) {
  const clean = String(hex || '').replace('#', '');
  if (clean.length === 3) {
    const r = parseInt(clean[0] + clean[0], 16) || 56;
    const g = parseInt(clean[1] + clean[1], 16) || 189;
    const b = parseInt(clean[2] + clean[2], 16) || 248;
    return `${r}, ${g}, ${b}`;
  }
  if (clean.length === 6) {
    const r = parseInt(clean.slice(0, 2), 16) || 56;
    const g = parseInt(clean.slice(2, 4), 16) || 189;
    const b = parseInt(clean.slice(4, 6), 16) || 248;
    return `${r}, ${g}, ${b}`;
  }
  return '56, 189, 248';
}

function formatTime(seconds) {
  const safe = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

async function initStage3D(containerEl, callbacks) {
  try {
    const mod = await import('./stage3d.js');
    if (typeof mod?.Stage3D !== 'function') {
      return null;
    }
    return new mod.Stage3D(containerEl, callbacks);
  } catch (err) {
    console.warn('Stage3D konnte nicht initialisiert werden:', err);
    return null;
  }
}

function bootstrap() {
  const songSelectorEl = document.getElementById('song-selector');
  const emptyStateEl = document.getElementById('empty-state');
  const emptyDetailEl = document.getElementById('empty-state-detail');
  const reloadCatalogBtn = document.getElementById('reload-catalog-btn');
  const mixerWorkspaceEl = document.getElementById('mixer-workspace');

  const stageCanvasHost = document.getElementById('stage-canvas-host');
  const stageFallbackEl = document.getElementById('stage-fallback');
  const stageSongMetaEl = document.getElementById('stage-song-meta');
  const stageSongTitleEl = document.getElementById('stage-song-title');
  const stageSongSubEl = document.getElementById('stage-song-sub');
  const stageOverlayEl = document.getElementById('stage-overlay');
  const stageSpinnerEl = document.getElementById('stage-spinner');
  const stageOverlayTitleEl = document.getElementById('stage-overlay-title');
  const stageProgressTrackEl = document.getElementById('stage-progress-track');
  const stageProgressFillEl = document.getElementById('stage-progress-fill');
  const stageRetryBtn = document.getElementById('stage-retry-btn');

  const cameraPillBtns = Array.from(
    document.querySelectorAll('.camera-pill[data-camera-view]')
  );

  const playPauseBtn = document.getElementById('play-pause-btn');
  const currentTimeEl = document.getElementById('current-time');
  const totalTimeEl = document.getElementById('total-time');
  const activeStemsBadgeEl = document.getElementById('active-stems-badge');
  const unmuteAllBtn = document.getElementById('unmute-all-btn');
  const masterScrubberEl = document.getElementById('master-scrubber');
  const lanesListEl = document.getElementById('lanes-list');

  let stage3d = null;
  let songs = [];
  let currentSong = null;
  let currentManifest = null;
  let currentLoadStatus = 'idle';
  let manifestController = null;
  let songLoadToken = 0;
  let isScrubbingMaster = false;
  let lastMasterSeekAt = 0;
  let rafId = null;

  const qrModal = new QrModal({
    triggerBtn: document.getElementById('qr-btn'),
    modalEl: document.getElementById('qr-modal'),
  });

  const updateTimeDisplay = (state) => {
    const dur = Number(state.duration) || 0;
    const cur = Math.max(0, Math.min(dur, Number(state.currentTime) || 0));
    totalTimeEl.textContent = formatTime(dur);

    if (!isScrubbingMaster) {
      currentTimeEl.textContent = formatTime(cur);
      const ratio = dur > 0 ? Math.max(0, Math.min(1, cur / dur)) : 0;
      const value = Math.round(ratio * 1000);
      masterScrubberEl.value = String(value);
      masterScrubberEl.style.setProperty('--scrub-pct', `${(ratio * 100).toFixed(2)}%`);
    }
  };

  const updateTransportUI = (state) => {
    const isPlaying = Boolean(state.isPlaying);
    playPauseBtn.classList.toggle('is-playing', isPlaying);
    playPauseBtn.setAttribute('aria-label', isPlaying ? 'Pause' : 'Abspielen');

    const stemIds = state.availableStemIds || [];
    const totalCount = stemIds.length;
    const activeCount = stemIds.filter((id) => !state.muted?.[id]).length;
    activeStemsBadgeEl.textContent = `${activeCount} / ${totalCount} aktiv`;

    const hasMuted = totalCount > 0 && (activeCount < totalCount || state.soloId !== null);
    unmuteAllBtn.classList.toggle('has-muted', hasMuted);

    updateTimeDisplay(state);
  };

  const updateLoadOverlay = (loadState) => {
    currentLoadStatus = loadState.status;

    if (loadState.status === 'loading') {
      stageOverlayEl.hidden = false;
      stageSpinnerEl.hidden = false;
      stageProgressTrackEl.hidden = false;
      stageRetryBtn.hidden = true;

      if (Number.isFinite(loadState.progress)) {
        stageOverlayTitleEl.textContent = `Lade Spuren… ${loadState.progress}%`;
        stageProgressFillEl.classList.remove('is-indeterminate');
        stageProgressFillEl.style.width = `${loadState.progress}%`;
      } else {
        stageOverlayTitleEl.textContent = 'Lade Spuren…';
        stageProgressFillEl.style.width = '';
        stageProgressFillEl.classList.add('is-indeterminate');
      }

      playPauseBtn.disabled = true;
      masterScrubberEl.disabled = true;
      unmuteAllBtn.disabled = true;
      return;
    }

    if (loadState.status === 'decoding') {
      stageOverlayEl.hidden = false;
      stageSpinnerEl.hidden = false;
      stageProgressTrackEl.hidden = false;
      stageRetryBtn.hidden = true;
      stageOverlayTitleEl.textContent = 'Dekodiere Audio…';
      stageProgressFillEl.style.width = '';
      stageProgressFillEl.classList.add('is-indeterminate');

      playPauseBtn.disabled = true;
      masterScrubberEl.disabled = true;
      unmuteAllBtn.disabled = true;
      return;
    }

    if (loadState.status === 'error') {
      stageOverlayEl.hidden = false;
      stageSpinnerEl.hidden = true;
      stageProgressTrackEl.hidden = true;
      stageRetryBtn.hidden = false;
      stageOverlayTitleEl.textContent =
        loadState.error?.message || 'Audiospuren konnten nicht geladen werden';

      playPauseBtn.disabled = true;
      masterScrubberEl.disabled = true;
      unmuteAllBtn.disabled = true;
      return;
    }

    if (loadState.status === 'ready') {
      stageOverlayEl.hidden = true;
      stageProgressFillEl.classList.remove('is-indeterminate');
      const hasStems = audio.getState().availableStemIds.length > 0;
      playPauseBtn.disabled = !hasStems;
      masterScrubberEl.disabled = !hasStems;
      unmuteAllBtn.disabled = !hasStems;
      return;
    }

    stageOverlayEl.hidden = true;
  };

  let lanesUI = null;

  const audio = new StemAudioEngine({
    onState: (state) => {
      updateTransportUI(state);
      lanesUI?.updatePlaybackState(state);
      stage3d?.setMutedState(state.muted);
    },
    onTime: (time) => {
      const state = audio.getState();
      if (!state.isPlaying) {
        updateTimeDisplay({ ...state, currentTime: time });
        lanesUI?.updatePlaybackState({ ...state, currentTime: time });
      }
    },
    onLoad: (loadState) => {
      updateLoadOverlay(loadState);
    },
    onEnded: () => {
      const state = audio.getState();
      updateTransportUI(state);
      lanesUI?.updatePlaybackState(state);
    },
  });

  lanesUI = new LanesUI(lanesListEl, {
    onToggleMute: (stemId) => {
      void audio.activate();
      audio.toggleMute(stemId);
    },
    onToggleSolo: (stemId) => {
      void audio.activate();
      audio.toggleSolo(stemId);
    },
    onVolumeChange: (stemId, volume01) => {
      void audio.activate();
      audio.setStemVolume(stemId, volume01);
    },
    onSeek: (seconds) => {
      void audio.activate();
      audio.seek(seconds);
    },
    onHoverStem: (stemId) => {
      lanesUI.setHoveredStem(stemId);
      stage3d?.setHoveredStem?.(stemId);
    },
  });

  const togglePlayPause = async () => {
    if (playPauseBtn.disabled) return;
    await audio.activate();
    if (audio.getState().isPlaying) {
      audio.pause();
    } else {
      await audio.play();
    }
  };

  playPauseBtn.addEventListener('click', () => {
    void togglePlayPause();
  });

  unmuteAllBtn.addEventListener('click', () => {
    void audio.activate();
    audio.unmuteAll();
  });

  stageRetryBtn.addEventListener('click', () => {
    if (currentSong) {
      void audio.activate();
      void selectSong(currentSong, { force: true });
    }
  });

  reloadCatalogBtn?.addEventListener('click', () => {
    void loadCatalog();
  });

  // Master Scrubber
  const getScrubberSeconds = () => {
    const dur = audio.getState().duration || 0;
    const ratio = Number(masterScrubberEl.value) / 1000;
    return Math.max(0, Math.min(dur, ratio * dur));
  };

  masterScrubberEl.addEventListener('pointerdown', () => {
    isScrubbingMaster = true;
    void audio.activate();
  });

  masterScrubberEl.addEventListener('input', () => {
    const dur = audio.getState().duration || 0;
    const ratio = Number(masterScrubberEl.value) / 1000;
    const target = Math.max(0, Math.min(dur, ratio * dur));
    currentTimeEl.textContent = formatTime(target);
    masterScrubberEl.style.setProperty('--scrub-pct', `${(ratio * 100).toFixed(2)}%`);

    const now = performance.now();
    if (now - lastMasterSeekAt >= 70) {
      lastMasterSeekAt = now;
      audio.seek(target);
    }
  });

  const finishMasterScrub = () => {
    if (!isScrubbingMaster) return;
    isScrubbingMaster = false;
    audio.seek(getScrubberSeconds());
  };

  masterScrubberEl.addEventListener('change', finishMasterScrub);
  masterScrubberEl.addEventListener('pointerup', finishMasterScrub);
  masterScrubberEl.addEventListener('pointercancel', () => {
    isScrubbingMaster = false;
  });

  // Camera view pills
  for (const btn of cameraPillBtns) {
    btn.addEventListener('click', () => {
      const viewName = btn.dataset.cameraView;
      if (!viewName) return;
      for (const pill of cameraPillBtns) {
        const active = pill === btn;
        pill.classList.toggle('is-active', active);
        pill.setAttribute('aria-pressed', String(active));
      }
      stage3d?.setCameraView(viewName);
    });
  }

  // Global keyboard shortcuts (ignored inside inputs)
  document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const target = e.target;
    if (
      target &&
      typeof target.closest === 'function' &&
      target.closest('input, textarea, select, [contenteditable="true"]')
    ) {
      return;
    }

    if (e.code === 'Space') {
      e.preventDefault();
      void togglePlayPause();
      return;
    }

    const keyLower = e.key.toLowerCase();
    if (keyLower === 'q') {
      e.preventDefault();
      qrModal.toggle();
      return;
    }

    if (keyLower === 'a' || e.key === '0') {
      e.preventDefault();
      void audio.activate();
      audio.unmuteAll();
      return;
    }

    if (e.key >= '1' && e.key <= '5') {
      const stemIds = audio.getState().availableStemIds;
      const stemId = stemIds[Number(e.key) - 1];
      if (stemId) {
        e.preventDefault();
        void audio.activate();
        audio.toggleMute(stemId);
      }
    }
  });

  function renderSongPills() {
    songSelectorEl.innerHTML = '';
    const fragment = document.createDocumentFragment();

    for (const song of songs) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'song-pill';
      btn.dataset.songId = song.id;

      const accent = song.accent || '#38bdf8';
      btn.style.setProperty('--pill-accent', accent);
      btn.style.setProperty('--pill-rgb', hexToRgbString(accent));

      const isActive = currentSong?.id === song.id;
      btn.classList.toggle('is-active', isActive);
      btn.setAttribute('aria-pressed', String(isActive));

      const titleEl = document.createElement('span');
      titleEl.className = 'song-pill-title';
      titleEl.textContent = song.title;

      const metaEl = document.createElement('span');
      metaEl.className = 'song-pill-meta';
      const metaParts = [];
      if (song.artist) metaParts.push(song.artist);
      if (Number.isFinite(song.bpm) && song.bpm > 0) metaParts.push(`${song.bpm} BPM`);
      metaEl.textContent = metaParts.join(' · ');

      btn.append(titleEl, metaEl);
      btn.addEventListener('click', () => {
        void audio.activate();
        void selectSong(song);
      });

      fragment.appendChild(btn);
    }

    songSelectorEl.appendChild(fragment);
  }

  function updateActiveSongTheme(song) {
    const accent = song?.accent || '#38bdf8';
    document.documentElement.style.setProperty('--song-accent', accent);
    document.documentElement.style.setProperty(
      '--song-accent-rgb',
      hexToRgbString(accent)
    );

    for (const pill of songSelectorEl.querySelectorAll('.song-pill')) {
      const active = pill.dataset.songId === song?.id;
      pill.classList.toggle('is-active', active);
      pill.setAttribute('aria-pressed', String(active));
    }

    if (song) {
      stageSongMetaEl.hidden = false;
      stageSongTitleEl.textContent = song.title || '';
      const subParts = [];
      if (song.artist) subParts.push(song.artist);
      if (Number.isFinite(song.bpm) && song.bpm > 0) subParts.push(`${song.bpm} BPM`);
      stageSongSubEl.textContent = subParts.join(' · ');
    } else {
      stageSongMetaEl.hidden = true;
    }
  }

  async function selectSong(song, { force = false } = {}) {
    if (!song) return;
    if (!force && currentSong?.id === song.id && currentLoadStatus === 'ready') {
      return;
    }

    const token = ++songLoadToken;
    manifestController?.abort();
    manifestController = new AbortController();

    currentSong = song;
    currentManifest = null;
    updateActiveSongTheme(song);
    updateLoadOverlay({ status: 'loading', progress: 0 });

    try {
      const response = await fetch(song.manifestUrl, {
        signal: manifestController.signal,
        cache: 'no-store',
      });
      if (!response.ok) {
        throw new Error(`Song-Manifest nicht gefunden (${response.status})`);
      }

      const manifest = await response.json();
      if (token !== songLoadToken) return;

      currentManifest = manifest;
      const stemIds = Array.isArray(manifest?.stems)
        ? manifest.stems.map((s) => s.id)
        : [];
      stage3d?.setAvailableStems(stemIds);
      stage3d?.setMutedState({});

      lanesUI.renderLanes(manifest);
      await audio.loadSong(manifest);
    } catch (error) {
      if (error?.name === 'AbortError' || token !== songLoadToken) {
        return;
      }
      updateLoadOverlay({ status: 'error', progress: null, error });
    }
  }

  async function loadCatalog() {
    try {
      const response = await fetch('./songs/index.json', { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(`Katalog nicht verfügbar (${response.status})`);
      }
      const catalog = await response.json();
      songs = Array.isArray(catalog?.songs) ? catalog.songs : [];
    } catch (error) {
      songs = [];
      if (emptyDetailEl && error?.message) {
        emptyDetailEl.textContent =
          'Sobald die Audiospuren im Katalog bereitstehen, erscheinen sie hier automatisch.';
      }
    }

    if (songs.length === 0) {
      currentSong = null;
      currentManifest = null;
      songSelectorEl.innerHTML = '';
      lanesUI.renderLanes({ stems: [] });
      stage3d?.setAvailableStems([]);
      mixerWorkspaceEl.hidden = true;
      emptyStateEl.hidden = false;
      updateLoadOverlay({ status: 'idle', progress: null });
      return;
    }

    emptyStateEl.hidden = true;
    mixerWorkspaceEl.hidden = false;

    renderSongPills();

    const requestedId = new URLSearchParams(window.location.search).get('song');
    const initialSong =
      (requestedId && songs.find((s) => s.id === requestedId)) || songs[0];

    await selectSong(initialSong, { force: true });
  }

  const startAnimationLoop = () => {
    const tick = () => {
      const state = audio.getState();
      const { levels, totalEnergy } = audio.getStemLevels();

      lanesUI.updateLevels(levels);
      if (state.isPlaying) {
        lanesUI.updatePlaybackState(state);
        updateTimeDisplay(state);
      }

      stage3d?.setAudioState({
        isPlaying: state.isPlaying,
        stemLevels: levels,
        totalEnergy,
        bpm: currentManifest?.bpm ?? currentSong?.bpm ?? 120,
        currentTime: state.currentTime,
      });

      rafId = window.requestAnimationFrame(tick);
    };
    rafId = window.requestAnimationFrame(tick);
  };

  let stageResizeObserver = null;

  async function init() {
    stage3d = await initStage3D(stageCanvasHost, {
      onToggleStem: (stemId) => {
        void audio.activate();
        audio.toggleMute(stemId);
      },
      onHoverStem: (stemId) => {
        lanesUI.setHoveredStem(stemId);
      },
    });

    if (!stage3d) {
      stageFallbackEl.hidden = false;
    } else if (typeof ResizeObserver !== 'undefined') {
      stageResizeObserver = new ResizeObserver(() => {
        stage3d?.resize();
      });
      stageResizeObserver.observe(stageCanvasHost);
    }

    startAnimationLoop();
    await loadCatalog();
  }

  window.addEventListener('beforeunload', () => {
    if (rafId !== null) {
      window.cancelAnimationFrame(rafId);
      rafId = null;
    }
    manifestController?.abort();
    stageResizeObserver?.disconnect();
    stage3d?.dispose();
    lanesUI.dispose();
    audio.dispose();
    qrModal.destroy();
  });

  void init();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
} else {
  bootstrap();
}
