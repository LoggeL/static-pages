// LUMEN audio: song loading (URL → file), Web-Audio transport clock, waveform peaks,
// synthetic beat click from the beat grid when no song is available, tap tempo.

const DEFAULT_SRC = "./audio/drum-show.mp3";
const PEAKS_PER_SEC = 50;
const LOOKAHEAD = 0.15; // s of clicks scheduled ahead
const wallNow = () => performance.now() / 1000;

export function computePeaks(buffer, perSec = PEAKS_PER_SEC) {
  const n = Math.ceil(buffer.duration * perSec), out = new Float32Array(n);
  const step = buffer.sampleRate / perSec;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const d = buffer.getChannelData(c);
    for (let i = 0; i < n; i++) {
      let m = out[i];
      const end = Math.min(d.length, Math.floor((i + 1) * step));
      for (let s = Math.floor(i * step); s < end; s += 4) { const v = d[s] < 0 ? -d[s] : d[s]; if (v > m) m = v; }
      out[i] = m;
    }
  }
  let mx = 0;
  for (let i = 0; i < n; i++) if (out[i] > mx) mx = out[i];
  if (mx > 0) for (let i = 0; i < n; i++) out[i] /= mx; // normalised 0..1
  return out;
}

export function createAudio(state) {
  let ctx = null, master = null, clickBus = null, buffer = null, node = null, timer = null;
  let volume = 0.8, click = true, nextBeat = 0, taps = [];
  let anchor = { clock: "wall", c0: 0, pos0: 0 };

  const tr = () => state.transport;
  const duration = () => (buffer ? buffer.duration : state.show.audio.duration || tr().duration || 204);
  const running = () => !!ctx && ctx.state === "running";
  const clockNow = (c) => (c === "ctx" && ctx ? ctx.currentTime : wallNow());
  const gestured = () => globalThis.navigator?.userActivation?.hasBeenActive ?? true;

  // AudioContext only after a user gesture (avoids autoplay warnings); until then the clock runs on wall time
  function ensureCtx() {
    if (ctx || !gestured()) return ctx;
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return null;
    try {
      ctx = new AC();
      master = ctx.createGain(); master.gain.value = volume; master.connect(ctx.destination);
      clickBus = ctx.createGain(); clickBus.gain.value = click ? 1 : 0; clickBus.connect(master);
      ctx.onstatechange = resync;
    } catch (e) { ctx = null; }
    return ctx;
  }
  function resync() {
    if (!tr().playing) return;
    const p = A.time();
    anchorAt(p);
    startNode(p);
    nextBeat = Math.ceil(state.beatAt(p) - 1e-6);
  }
  function anchorAt(pos) {
    const clock = running() ? "ctx" : "wall";
    anchor = { clock, c0: clockNow(clock), pos0: pos };
  }

  function stopNode() {
    if (!node) return;
    try { node.onended = null; node.stop(); node.disconnect(); } catch (e) { /* already stopped */ }
    node = null;
  }
  function startNode(pos) {
    stopNode();
    if (!buffer || !running() || pos >= buffer.duration) return;
    node = ctx.createBufferSource();
    node.buffer = buffer;
    node.playbackRate.value = tr().rate || 1;
    node.connect(master);
    node.start(0, Math.max(0, pos));
  }

  function clickAt(when, accent) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = accent ? 1760 : 1180;
    g.gain.setValueAtTime(0.0001, when);
    g.gain.linearRampToValueAtTime(accent ? 0.32 : 0.18, when + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.045);
    o.connect(g).connect(clickBus);
    o.start(when); o.stop(when + 0.06);
    if (buffer) return; // song plays: click only, no kick
    const k = ctx.createOscillator(), kg = ctx.createGain();
    k.frequency.setValueAtTime(accent ? 150 : 120, when);
    k.frequency.exponentialRampToValueAtTime(42, when + 0.12);
    kg.gain.setValueAtTime(accent ? 0.9 : 0.5, when);
    kg.gain.exponentialRampToValueAtTime(0.0001, when + (accent ? 0.3 : 0.18));
    k.connect(kg).connect(clickBus);
    k.start(when); k.stop(when + 0.32);
  }

  function tick() {
    const t = A.time(), T = tr();
    if (T.loop && T.loop.end > T.loop.start && t >= T.loop.end) { A.seek(T.loop.start); return; }
    if (t >= duration() - 1e-3) { A.pause(); return; }
    if (!click || !running() || anchor.clock !== "ctx") return;
    const rate = T.rate || 1, bpb = state.show.audio.beatsPerBar || 4, db = state.show.audio.downbeat || 0;
    for (let guard = 0; guard < 16; guard++) {
      const bt = state.timeAtBeat(nextBeat);
      if (bt > t + LOOKAHEAD) break;
      if (bt >= t - 0.02 && bt < duration()) clickAt(Math.max(ctx.currentTime, anchor.c0 + (bt - anchor.pos0) / rate), (((nextBeat - db) % bpb) + bpb) % bpb === 0);
      nextBeat++;
    }
  }

  function setBuffer(buf, source, name) {
    const playing = tr().playing, pos = A.time();
    stopNode();
    buffer = buf;
    A.source = source; A.name = name;
    A.peaks = buf ? computePeaks(buf) : null;
    A.peaksPerSec = buf ? PEAKS_PER_SEC : 0;
    A.click = source === "synth";
    state.setTransport({ duration: duration() });
    if (playing) { anchorAt(Math.min(pos, duration())); startNode(anchor.pos0); }
    state.emit("audio:loaded", { source, name, duration: duration() });
  }

  async function decode(arrayBuf) {
    // OfflineAudioContext decodes without needing a user gesture
    const OAC = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
    const dc = ctx || new OAC(2, 44100, 44100);
    return await dc.decodeAudioData(arrayBuf);
  }

  const A = {
    source: "synth", name: "", peaks: null, peaksPerSec: 0,
    get click() { return click; },
    set click(v) { click = !!v; if (clickBus) clickBus.gain.value = click ? 1 : 0; },
    get volume() { return volume; },
    set volume(v) { volume = Math.max(0, Math.min(1, +v || 0)); if (master) master.gain.value = volume; },
    get ctx() { return ctx; },
    get duration() { return duration(); },

    async init() {
      if (typeof document !== "undefined") {
        const wake = () => {
          const fresh = !ctx;
          if (!ensureCtx()) return;
          ctx.resume().then(() => { if (fresh) resync(); }).catch(() => {});
        };
        for (const ev of ["pointerdown", "keydown"]) document.addEventListener(ev, wake, { capture: true, passive: true });
      }
      const url = state.show.audio.src || DEFAULT_SRC;
      try {
        const r = await fetch(url);
        if (!r.ok || (r.headers.get("content-type") || "").includes("text/html")) throw new Error(`HTTP ${r.status}`);
        const buf = await decode(await r.arrayBuffer());
        setBuffer(buf, "url", url.split("/").pop());
        state.status(`Song geladen (${Math.round(buf.duration)} s)`, "ok");
      } catch (e) {
        setBuffer(null, "synth", "Beat-Klick");
        state.status("Kein Song gefunden – Demo läuft mit synthetischem Beat-Klick. Eigene MP3 über „Song laden“ oder per Drag & Drop.", "warn");
      }
    },

    async loadFile(file) {
      try {
        const buf = await decode(await file.arrayBuffer());
        setBuffer(buf, "file", file.name || "Song");
        state.status(`„${A.name}“ geladen (${Math.round(buf.duration)} s)`, "ok");
        return true;
      } catch (e) {
        state.status(`Audiodatei konnte nicht gelesen werden: ${e.message || e}`, "error");
        return false;
      }
    },

    time() {
      if (!tr().playing) return anchor.pos0;
      return Math.min(duration(), anchor.pos0 + (clockNow(anchor.clock) - anchor.c0) * (tr().rate || 1));
    },

    play() {
      if (tr().playing) return;
      ensureCtx();
      if (ctx && ctx.state !== "running") ctx.resume().catch(() => {});
      let pos = anchor.pos0;
      if (pos >= duration() - 0.05) pos = 0;
      anchorAt(pos);
      startNode(pos);
      nextBeat = Math.ceil(state.beatAt(pos) - 1e-6);
      clearInterval(timer);
      timer = setInterval(tick, 25);
      state.setTransport({ playing: true, t: pos });
    },

    pause() {
      if (!tr().playing) return;
      const pos = A.time();
      stopNode();
      clearInterval(timer); timer = null;
      anchor = { clock: "wall", c0: 0, pos0: pos };
      state.setTransport({ playing: false, t: pos });
    },

    toggle() { tr().playing ? A.pause() : A.play(); },

    seek(t) {
      const pos = Math.max(0, Math.min(duration(), +t || 0));
      if (tr().playing) { anchorAt(pos); startNode(pos); nextBeat = Math.ceil(state.beatAt(pos) - 1e-6); }
      else anchor = { clock: "wall", c0: 0, pos0: pos };
      state.setTransport({ t: pos });
    },

    stop() { A.pause(); A.seek(0); },

    // Tap tempo: ≥ 3 taps (gaps < 2 s) set state.live.tap; returns bpm or null
    tap() {
      const w = wallNow();
      if (taps.length && w - taps[taps.length - 1] > 2) taps = [];
      taps.push(w);
      if (taps.length > 8) taps.shift();
      if (taps.length < 3) return null;
      const bpm = Math.round((600 * (taps.length - 1)) / (taps[taps.length - 1] - taps[0])) / 10;
      state.setTap(bpm, A.time());
      nextBeat = Math.ceil(state.beatAt(A.time()) - 1e-6);
      return bpm;
    },
    clearTap() { taps = []; state.setTap(null); },
  };
  return A;
}
