// StemStage – main.js: verdrahtet AudioEngine, Stage3D und UI.
import { AudioEngine } from './audio-engine.js';
import { UI, DEFAULT_COLORS, DEFAULT_LABELS } from './ui.js';
import { tryPassword, decryptBuffer } from './crypto.js';

const ui = new UI();
const engine = new AudioEngine();
ui.attachEngine(engine);
// ?mute=1 → stummer Testmodus (Visuals laufen, kein Ton)
const MUTED = new URLSearchParams(location.search).has('mute');
if (MUTED) {
  const origUnlock = engine.unlock.bind(engine);
  engine.unlock = async () => { const r = await origUnlock(); engine.setMasterVolume(0); return r; };
  engine.setMasterVolume = ((orig) => (v) => orig(0))(engine.setMasterVolume.bind(engine));
}

const state = {
  songs: [],
  current: null,     // in der UI gewählter Song
  loadedId: null,    // Song, den die Engine fertig geladen hat
  started: false,    // Tap-to-Start erledigt (Audio entsperrt)
  loading: false,
  stage: null,
  wakeLock: null,
  lastPosUpdate: 0,
  encMeta: null,     // songs.json → "encryption" (nur im veröffentlichten Build)
  key: null,         // entsperrter AES-Schlüssel
  password: null,    // Klassen-Passwort (für den QR-Code)
};

// Für Debugging in der Konsole.
window.stemstage = { engine, ui, state };

/* ─────────────────────────── Start ─────────────────────────── */

wireUi();
wireEngine();
setupMediaSession();
const stageReady = initStage();
boot();

async function boot() {
  let songs;
  try {
    const data = await fetchSongs();
    songs = normalizeSongs(data.songs);
    state.encMeta = data.encryption || null;
    if (state.encMeta) await initKey();
  } catch (err) {
    console.error('[StemStage] songs.json konnte nicht geladen werden:', err);
    ui.showFatal('Die Songliste (songs/songs.json) konnte nicht geladen werden. Läuft die App über einen Webserver?');
    return;
  }
  if (!songs.length) {
    ui.showFatal('Es sind noch keine Songs vorhanden.');
    return;
  }
  state.songs = songs;

  const wanted = new URLSearchParams(location.search).get('song');
  const song = songs.find((s) => s.id === wanted) || songs[0];
  ui.setSongs(songs, song.id);
  markLocks();
  setCurrent(song);
  // Wurde schon vor dem Laden der Liste getippt, Start-Overlay nicht erneut öffnen.
  if (!state.started) ui.showStart(song);

  await stageReady;
  // Falls schon vor dem Laden der Liste getippt wurde.
  if (state.started && !state.loading && state.loadedId !== song.id) loadSong(song, { autoplay: true });
}

async function fetchSongs() {
  const res = await fetch('songs/songs.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return Array.isArray(data) ? { songs: data } : { songs: data.songs || [], encryption: data.encryption };
}

/* ─────────────────────────── Passwortschutz ─────────────────────────── */

const PW_STORE = 'stemstage.pw';
const isLocked = (song) => !!song?.stems.some((s) => s.encrypted) && !state.key;

/** Passwort aus dem QR-Link (#pw=…) oder vom letzten Mal übernehmen. */
async function initKey() {
  let fromHash = null;
  try {
    fromHash = new URLSearchParams(location.hash.slice(1)).get('pw');
    if (fromHash) {
      const u = new URL(location.href);
      u.hash = '';
      history.replaceState(history.state, '', u); // Passwort nicht in der Adresszeile stehen lassen
    }
  } catch { /* egal */ }
  let stored = null;
  try { stored = localStorage.getItem(PW_STORE); } catch { /* privat-Modus */ }
  for (const pw of [fromHash, stored]) {
    const key = await tryPassword(pw, state.encMeta);
    if (key) { setKey(key, pw); return true; }
  }
  if (fromHash) ui.toast('Das Passwort im Link stimmt nicht', { color: '#ff3d8b' });
  return false;
}

function setKey(key, pw) {
  state.key = key;
  state.password = pw;
  engine.decryptor = (buf) => decryptBuffer(key, buf);
  try { localStorage.setItem(PW_STORE, pw); } catch { /* egal */ }
  markLocks();
}

function markLocks() {
  document.querySelectorAll('.song-chip').forEach((b) => {
    const song = state.songs.find((s) => s.id === b.dataset.id);
    b.classList.toggle('is-locked', isLocked(song));
  });
}

let pwDialog = null;
/** Fragt das Klassen-Passwort ab. Löst mit true (entsperrt) oder false (abgebrochen) auf. */
function askPassword(song) {
  if (!pwDialog) {
    const el = document.createElement('div');
    el.className = 'overlay pw-overlay';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-labelledby', 'pwTitle');
    el.innerHTML = `
      <form class="load-card glass pw-card" novalidate>
        <p class="fatal-emoji" aria-hidden="true">🔒</p>
        <h2 class="load-title" id="pwTitle">Klassen-Passwort</h2>
        <p class="fatal-text pw-text"></p>
        <input class="pw-input" type="password" name="pw" autocomplete="off" autocapitalize="off" spellcheck="false"
               enterkeyhint="go" placeholder="Passwort" aria-label="Passwort" required>
        <p class="pw-error" role="alert" hidden>Leider falsch – frag deine Lehrkraft 🙂</p>
        <div class="load-actions">
          <button class="pill-btn is-primary" type="submit">Entsperren</button>
          <button class="pill-btn pw-cancel" type="button">Demo-Song hören</button>
        </div>
        <p class="pw-hint">Tipp: Wer den QR-Code an der Wand scannt, muss nichts eintippen.</p>
      </form>`;
    document.body.appendChild(el);
    pwDialog = el;
  }
  const el = pwDialog;
  const form = el.querySelector('form');
  const input = el.querySelector('.pw-input');
  const err = el.querySelector('.pw-error');
  const btn = form.querySelector('[type=submit]');
  el.querySelector('.pw-text').textContent =
    `„${song.title}“ ist nur für den Unterricht freigegeben. Gib das Passwort ein, das deine Lehrkraft genannt hat.`;
  err.hidden = true;
  input.value = '';
  el.hidden = false;
  requestAnimationFrame(() => { el.classList.add('is-open'); input.focus({ preventScroll: true }); });

  return new Promise((resolve) => {
    const close = (ok) => {
      el.classList.remove('is-open');
      form.onsubmit = null;
      el.querySelector('.pw-cancel').onclick = null;
      resolve(ok);
    };
    form.onsubmit = async (e) => {
      e.preventDefault();
      btn.disabled = true;
      const key = await tryPassword(input.value.trim(), state.encMeta);
      btn.disabled = false;
      if (key) { setKey(key, input.value.trim()); close(true); return; }
      err.hidden = false;
      input.select();
    };
    el.querySelector('.pw-cancel').onclick = () => close(false);
  });
}

function normalizeSongs(list) {
  return list
    .filter((s) => s && s.id && Array.isArray(s.stems) && s.stems.length)
    .map((s) => ({
      ...s,
      title: s.title || s.id,
      artist: s.artist || '',
      stems: s.stems.map((st) => {
        const instrument = DEFAULT_COLORS[st.instrument] ? st.instrument : 'other';
        return {
          ...st,
          instrument,
          label: st.label || DEFAULT_LABELS[instrument],
          color: st.color || DEFAULT_COLORS[instrument],
        };
      }),
    }));
}

async function initStage() {
  const container = document.getElementById('stage');
  try {
    const { Stage3D } = await import('./stage3d.js');
    const stage = new Stage3D(container, engine);
    stage.onMemberClick((id) => {
      ui.hideStageHint();
      toggleStem(id);
    });
    state.stage = stage;
    if (state.loadedId && engine.song) withStage((s) => s.setSong(engine.song));
  } catch (err) {
    console.warn('[StemStage] 3D-Bühne deaktiviert:', err);
    state.stage = null;
    container.replaceChildren();
    ui.disableStage();
  }
}

function withStage(fn) {
  if (!state.stage) return;
  try { fn(state.stage); } catch (err) { console.warn('[StemStage] Stage-Aufruf fehlgeschlagen:', err); }
}

/* ─────────────────────────── Songs ─────────────────────────── */

function setCurrent(song) {
  state.current = song;
  ui.setActiveSong(song.id);
  ui.setSong(song);
  updateUrl(song.id);
  updateMediaMetadata(song);
  if (state.loadedId === song.id) ui.onSongLoaded();
}

async function loadSong(song, { autoplay = false } = {}) {
  if (state.loading) return false;
  if (isLocked(song)) {
    const ok = await askPassword(song);
    if (!ok) {
      // Abgebrochen → ersten frei hörbaren Song nehmen
      const free = state.songs.find((s) => !isLocked(s));
      if (free && free.id !== song.id) { setCurrent(free); return loadSong(free, { autoplay }); }
      return false;
    }
  }
  state.loading = true;
  state.loadedId = null;
  ui.setBusy(true);
  ui.showLoading(song);
  try {
    await engine.load(song, (p) => ui.setLoadingProgress(p));
  } catch (err) {
    console.error('[StemStage] Laden fehlgeschlagen:', err);
    state.loading = false;
    ui.setBusy(false);
    ui.showLoadError(`„${song.title}“ konnte nicht geladen werden. Prüfe deine Verbindung.`);
    return false;
  }
  state.loading = false;
  ui.setBusy(false);
  handleLoaded(engine.song || song);
  ui.setLoadingProgress(1);
  ui.hideLoading();
  if (autoplay) play();
  return true;
}

function handleLoaded(song) {
  if (!song || state.loadedId === song.id) return;
  state.loadedId = song.id;
  // Engine könnte (theoretisch) einen anderen Song melden als gewählt → UI nachziehen.
  if (state.current?.id !== song.id) {
    const s = state.songs.find((x) => x.id === song.id);
    if (s) { state.current = s; ui.setActiveSong(s.id); ui.setSong(s); }
  }
  ui.onSongLoaded();
  withStage((s) => s.setSong(song));
  updateMediaMetadata(state.current || song);
}

function selectSong(id) {
  if (state.loading) return;
  const song = state.songs.find((s) => s.id === id);
  if (!song || song.id === state.current?.id) return;
  const wasPlaying = engine.isPlaying;
  setCurrent(song);
  if (state.started) loadSong(song, { autoplay: wasPlaying });
}

function stepSong(dir) {
  if (!state.songs.length || !state.current) return;
  const i = state.songs.findIndex((s) => s.id === state.current.id);
  const next = state.songs[(i + dir + state.songs.length) % state.songs.length];
  selectSong(next.id);
}

function updateUrl(id) {
  try {
    const u = new URL(location.href);
    u.searchParams.set('song', id);
    history.replaceState(history.state, '', u);
  } catch { /* z. B. file:// */ }
}

function shareUrl() {
  const u = new URL(location.href);
  u.search = '';
  u.hash = '';
  if (state.current) u.searchParams.set('song', state.current.id);
  // Klassen-Passwort steckt im Fragment: wird nie an den Server geschickt, entsperrt aber beim Scannen.
  if (state.password) u.hash = 'pw=' + encodeURIComponent(state.password);
  return u.toString();
}

/* ─────────────────────────── Aktionen ─────────────────────────── */

function startApp() {
  if (state.started) return;
  state.started = true;
  // unlock() MUSS synchron im User-Gesture aufgerufen werden (iOS).
  let unlocking;
  try { unlocking = Promise.resolve(engine.unlock()); } catch (err) { unlocking = Promise.reject(err); }
  ui.hideStart();
  unlocking
    .then(() => {
      if (state.current && !state.loading) return loadSong(state.current, { autoplay: true });
      return undefined;
    })
    .catch((err) => {
      console.error('[StemStage] Audio konnte nicht entsperrt werden:', err);
      state.started = false;
      ui.toast('Audio konnte nicht gestartet werden – bitte nochmal tippen');
      ui.showStart(state.current);
    });
}

const isLoaded = () => !!(state.loadedId && engine.song && engine.song.id === state.loadedId);

function play() {
  if (!isLoaded()) return;
  const d = engine.duration;
  if (d && engine.currentTime >= d - 0.05) engine.seek(0);
  engine.play();
}

function togglePlay() {
  if (!state.started) { startApp(); return; }
  if (!isLoaded()) return;
  if (engine.isPlaying) engine.pause();
  else play();
}

function seekTo(sec) {
  if (!isLoaded()) return;
  const d = engine.duration || 0;
  engine.seek(Math.max(0, Math.min(d > 0 ? d - 0.01 : 0, sec)));
}

function stemInfo(id) {
  return state.current?.stems.find((s) => s.id === id) || { id, label: id, color: '#ffffff' };
}

function toggleStem(id) {
  if (!isLoaded()) return;
  engine.toggleStem(id);
  const stem = stemInfo(id);
  const on = engine.isEnabled(id);
  ui.toast(`${stem.label} ${on ? 'an' : 'aus'}`, { color: stem.color, off: !on });
}

function toggleSolo(id) {
  if (!isLoaded()) return;
  engine.toggleSolo(id);
  const soloId = engine.soloId;
  if (soloId) {
    const stem = stemInfo(soloId);
    ui.toast(`Solo: ${stem.label}`, { color: stem.color });
  } else {
    ui.toast('Solo aus – alle zusammen', { color: '#ffd84d' });
  }
}

function allOn() {
  if (!isLoaded()) return;
  engine.enableAll();
  if (engine.soloId != null) engine.setSolo(null);
  ui.toast('Alle Instrumente an 🎉', { color: '#7cff4d' });
}

function toggleQr() {
  if (ui.qrOpen) ui.hideQr();
  else ui.showQr(shareUrl(), state.current);
}

/* ─────────────────────────── Verdrahtung ─────────────────────────── */

function wireUi() {
  ui.on('start', startApp)
    .on('togglePlay', togglePlay)
    .on('selectSong', selectSong)
    .on('toggleStem', (id) => { ui.hideStageHint(); toggleStem(id); })
    .on('solo', (id) => { ui.hideStageHint(); toggleSolo(id); })
    .on('allOn', allOn)
    .on('seekFraction', (f) => seekTo(f * (engine.duration || 0)))
    .on('seekBy', (delta) => seekTo((engine.currentTime || 0) + delta))
    .on('volume', (v) => { try { engine.setMasterVolume(v); } catch (err) { console.warn(err); } })
    .on('qr', toggleQr)
    .on('closeQr', () => ui.hideQr())
    .on('retry', () => { if (state.current) loadSong(state.current, { autoplay: true }); })
    .on('laneHover', (id) => withStage((s) => s.highlight && s.highlight(id)));
}

function wireEngine() {
  engine.addEventListener('statechange', (e) => {
    const playing = e.detail ? !!e.detail.isPlaying : engine.isPlaying;
    ui.setPlaying(playing);
    if ('mediaSession' in navigator) {
      try { navigator.mediaSession.playbackState = playing ? 'playing' : 'paused'; } catch { /* egal */ }
    }
    if (playing) requestWakeLock();
    else releaseWakeLock();
  });
  engine.addEventListener('stemchange', () => ui.syncStems());
  engine.addEventListener('timeupdate', (e) => {
    const t = e.detail?.currentTime ?? engine.currentTime;
    ui.setTime(t);
    updatePositionState(t);
  });
  engine.addEventListener('ended', () => {
    ui.setPlaying(false);
    releaseWakeLock();
  });
  engine.addEventListener('loaded', (e) => handleLoaded(e.detail?.song || engine.song));
}

/* ─────────────────────────── Media Session & Wake Lock ─────────────────────────── */

function setupMediaSession() {
  if (!('mediaSession' in navigator)) return;
  const set = (action, fn) => {
    try { navigator.mediaSession.setActionHandler(action, fn); } catch { /* nicht unterstützt */ }
  };
  set('play', () => play());
  set('pause', () => engine.pause());
  set('seekbackward', (d) => seekTo((engine.currentTime || 0) - (d?.seekOffset || 10)));
  set('seekforward', (d) => seekTo((engine.currentTime || 0) + (d?.seekOffset || 10)));
  set('seekto', (d) => { if (d && Number.isFinite(d.seekTime)) seekTo(d.seekTime); });
  set('previoustrack', () => stepSong(-1));
  set('nexttrack', () => stepSong(1));
}

function updateMediaMetadata(song) {
  if (!song || !('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: song.title,
      artist: song.artist || 'StemStage',
      album: 'StemStage',
    });
  } catch { /* egal */ }
}

function updatePositionState(t) {
  if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return;
  const now = performance.now();
  if (now - state.lastPosUpdate < 1000) return;
  state.lastPosUpdate = now;
  const duration = engine.duration;
  if (!(duration > 0)) return;
  try {
    navigator.mediaSession.setPositionState({ duration, position: Math.min(Math.max(0, t), duration), playbackRate: 1 });
  } catch { /* egal */ }
}

async function requestWakeLock() {
  if (!('wakeLock' in navigator) || state.wakeLock || document.visibilityState !== 'visible') return;
  try {
    const lock = await navigator.wakeLock.request('screen');
    state.wakeLock = lock;
    lock.addEventListener('release', () => { if (state.wakeLock === lock) state.wakeLock = null; });
  } catch { /* z. B. Energiesparmodus */ }
}

function releaseWakeLock() {
  const lock = state.wakeLock;
  state.wakeLock = null;
  if (lock) lock.release().catch(() => {});
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && engine.isPlaying) requestWakeLock();
});
