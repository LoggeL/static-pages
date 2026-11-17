/**
 * StemStage – AudioEngine
 * Sample-synchrone Mehrspur-Wiedergabe mit der Web Audio API.
 *
 * Graph pro Stem:
 *   BufferSource ─┬─> muteGain ──> transport ──> master ──> compressor ──> destination
 *                 └─> analyser ──> sink (Gain 0) ──> destination
 *
 * Der Analyser hängt VOR dem Mute-Gain, damit getLevel() auch bei stummen
 * Stems den Pegel des Signals liefert. Der 0-Gain-Sink sorgt dafür, dass der
 * Analyser im Graph gezogen wird. `transport` blendet beim Stoppen/Starten
 * kurz aus/ein (Klickschutz), `master` trägt die Lautstärke.
 *
 * Events (CustomEvent): statechange {isPlaying}, stemchange {stemId, enabled,
 * audible, soloId}, timeupdate {currentTime}, ended, loaded {song}.
 */

const START_DELAY = 0.05; // s Vorlauf für gemeinsamen Start
const MUTE_TC = 0.008; // setTargetAtTime-Zeitkonstante → ~25 ms bis ~95 %
const FADE_OUT = 0.015; // s Transport-Ausblendung beim Stoppen
const FADE_IN = 0.01; // s Transport-Einblendung beim Starten
const TICK_MS = 100; // timeupdate-Intervall
const FFT_SIZE = 1024;
const LEVEL_GAIN = 4; // RMS-Skalierung für getLevel
const LEVEL_ATTACK = 0.03; // s
const LEVEL_RELEASE = 0.25; // s
const LEVEL_IDLE_RELEASE = 0.6; // s, Abklingen wenn nicht gespielt wird
const FETCH_WEIGHT = 0.85; // Anteil des Downloads am Fortschritt (Rest: Decode)

const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/**
 * @typedef {Object} Stem
 * @property {string} id
 * @property {Object} def          Stem-Definition aus songs.json
 * @property {boolean} enabled
 * @property {AudioBuffer|null} buffer
 * @property {GainNode} gain       Mute/Solo-Gain
 * @property {AnalyserNode} analyser
 * @property {number} target       aktuelles Gain-Ziel (0|1)
 * @property {Float32Array} timeBuf
 * @property {Uint8Array|null} byteBuf  Fallback für alte Safari-Versionen
 * @property {number} level        geglätteter Pegel
 * @property {number} levelT       Zeitpunkt der letzten Pegelberechnung (ms)
 * @property {number} maxAbs       Absolutmaximum des Buffers (-1 = unbekannt)
 */

export class AudioEngine extends EventTarget {
  constructor() {
    super();
    /** @type {AudioContext|null} */
    this._ctx = null;
    this._master = null;
    this._transport = null;
    this._sink = null;
    this._volume = 1;

    this._song = null;
    /** @type {Map<string, Stem>} */
    this._stems = new Map();
    this._soloId = null;
    this._ready = false;
    this._duration = 0;

    this._loadToken = 0;
    this._abort = null;

    this._playing = false;
    this._offset = 0; // Songposition (s) bei Pause bzw. beim letzten Start
    this._startAt = 0; // ctx-Zeit, zu der _offset erklingt
    this._sources = [];
    this._pending = 0; // noch laufende Sources der aktuellen Generation
    this._playGen = 0; // verhindert 'ended' von manuell gestoppten Sources
    this._timer = null;
    this._unlocked = false;

    /** @type {Map<string, Float32Array>} */
    this._peakCache = new Map();
    this._songPeak = -1;
  }

  // ───────────────────────── Getter ─────────────────────────

  /** Aktuelle Songposition in Sekunden. */
  get currentTime() {
    if (!this._playing || !this._ctx) return this._offset;
    const t = this._offset + Math.max(0, this._ctx.currentTime - this._startAt);
    return Math.min(t, this._duration);
  }

  /** Songlänge in Sekunden (längster Buffer, sonst song.duration). */
  get duration() {
    return this._duration;
  }

  get isPlaying() {
    return this._playing;
  }

  /** Aktueller (bzw. gerade ladender) Song oder null. */
  get song() {
    return this._song;
  }

  get soloId() {
    return this._soloId;
  }

  // ───────────────────────── Setup ─────────────────────────

  /**
   * AudioContext erzeugen/fortsetzen. Im ersten User-Gesture aufrufen (iOS).
   * @returns {Promise<boolean>} true, wenn der Context läuft
   */
  async unlock() {
    const ctx = this._ensureContext();
    if (!ctx) return false;
    if (!this._unlocked) {
      // iOS: synchron im Gesture einen 1-Sample-Leerbuffer abspielen.
      try {
        const src = ctx.createBufferSource();
        src.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
        src.connect(ctx.destination);
        src.onended = () => safeDisconnect(src);
        src.start(0);
        this._unlocked = true;
      } catch {
        /* ignorieren */
      }
    }
    if (ctx.state !== 'running') {
      try {
        await ctx.resume();
      } catch {
        /* ignorieren */
      }
    }
    return ctx.state === 'running';
  }

  /**
   * Lädt einen Song: stoppt die Wiedergabe, setzt Stem-Zustände zurück,
   * lädt und dekodiert alle Stems parallel.
   * Wird währenddessen erneut load() aufgerufen, wird dieser Ladevorgang verworfen.
   * Einzelne fehlerhafte Stems bleiben stumm (console.warn); schlagen alle fehl, wird geworfen.
   * @param {Object} song Song-Objekt aus songs.json
   * @param {(p:number)=>void} [onProgress] Fortschritt 0..1
   * @returns {Promise<boolean>} true = geladen und aktiv, false = durch neueren load() verworfen
   */
  async load(song, onProgress) {
    const token = ++this._loadToken;
    if (this._abort) this._abort.abort();
    const abort = typeof AbortController !== 'undefined' ? new AbortController() : null;
    this._abort = abort;
    const stale = () => token !== this._loadToken;

    this._halt();
    this._teardownStems();
    this._ready = false;
    this._song = song || null;
    this._soloId = null;
    this._offset = 0;
    this._duration = Number(song && song.duration) || 0;
    this._peakCache.clear();
    this._songPeak = -1;
    this._emit('timeupdate', { currentTime: 0 });

    if (!song || !Array.isArray(song.stems)) return false;
    const ctx = this._ensureContext();
    if (!ctx) throw new Error('Web Audio API wird von diesem Browser nicht unterstützt.');

    const defs = song.stems;
    for (const def of defs) this._stems.set(def.id, this._createStem(def));

    const n = defs.length || 1;
    const frac = new Float32Array(defs.length);
    let reported = -1;
    const report = () => {
      if (!onProgress || stale()) return;
      let sum = 0;
      for (let i = 0; i < frac.length; i++) sum += frac[i];
      const p = clamp(sum / n, 0, 1);
      if (p < 1 && p - reported < 0.005) return;
      if (p <= reported) return;
      reported = p;
      try {
        onProgress(p);
      } catch (err) {
        console.error(err);
      }
    };
    if (onProgress) {
      reported = 0;
      try {
        onProgress(0);
      } catch (err) {
        console.error(err);
      }
    }

    const buffers = await Promise.all(
      defs.map(async (def, i) => {
        try {
          let data = await fetchArrayBuffer(def.file, abort && abort.signal, (f) => {
            frac[i] = f * FETCH_WEIGHT;
            report();
          });
          if (stale()) return null;
          frac[i] = FETCH_WEIGHT;
          report();
          if (def.encrypted) {
            if (typeof this.decryptor !== 'function') throw new Error('Kein Schlüssel für verschlüsselten Stem');
            data = await this.decryptor(data);
            if (stale()) return null;
          }
          let buf = await decodeAudio(ctx, data);
          if (LITE_MODE) buf = toMono(ctx, buf);
          frac[i] = 1;
          report();
          return buf;
        } catch (err) {
          if (!stale()) {
            console.warn(`[AudioEngine] Stem "${def.id}" konnte nicht geladen werden:`, err);
            frac[i] = 1;
            report();
          }
          return null;
        }
      })
    );

    if (stale()) return false;
    this._abort = null;

    let maxDur = 0;
    let loadedCount = 0;
    defs.forEach((def, i) => {
      const stem = this._stems.get(def.id);
      const buf = buffers[i];
      if (!stem || !buf) return;
      stem.buffer = buf;
      loadedCount++;
      if (buf.duration > maxDur) maxDur = buf.duration;
    });
    if (!loadedCount) throw new Error(`Song "${song.title || song.id}" konnte nicht geladen werden.`);

    this._duration = maxDur || this._duration;
    this._ready = true;
    this._emit('loaded', { song });
    return true;
  }

  // ───────────────────────── Transport ─────────────────────────

  play() {
    if (this._playing || !this._ready || !this._ctx) return;
    const ctx = this._ctx;
    if (ctx.state !== 'running') {
      try {
        const p = ctx.resume();
        if (p && p.catch) p.catch(() => {});
      } catch {
        /* ignorieren */
      }
    }
    if (this._offset >= this._duration - 0.005) this._offset = 0;
    this._startSources(this._offset);
    this._playing = true;
    this._startTimer();
    this._emit('statechange', { isPlaying: true });
  }

  pause() {
    if (!this._playing) return;
    this._offset = this.currentTime;
    this._stopSources();
    this._playing = false;
    this._stopTimer();
    this._emit('statechange', { isPlaying: false });
    this._emit('timeupdate', { currentTime: this._offset });
  }

  toggle() {
    if (this._playing) this.pause();
    else this.play();
  }

  /** Springt zu `seconds` – in Play (Neustart aller Sources) und Pause. */
  seek(seconds) {
    let s = Number(seconds);
    if (!Number.isFinite(s)) return;
    s = clamp(s, 0, this._duration);
    if (this._playing) {
      if (s >= this._duration) {
        this._finish();
        return;
      }
      this._stopSources();
      this._startSources(s);
    } else {
      this._offset = s;
    }
    this._emit('timeupdate', { currentTime: s });
  }

  // ───────────────────────── Stems ─────────────────────────

  setEnabled(stemId, enabled) {
    const stem = this._stems.get(stemId);
    if (!stem) return;
    enabled = !!enabled;
    if (stem.enabled === enabled) return;
    stem.enabled = enabled;
    this._applyGains();
    this._emitStem(stem);
  }

  toggleStem(stemId) {
    const stem = this._stems.get(stemId);
    if (stem) this.setEnabled(stemId, !stem.enabled);
  }

  isEnabled(stemId) {
    const stem = this._stems.get(stemId);
    return stem ? stem.enabled : false;
  }

  /**
   * Solo setzen. Erneutes Setzen derselben id hebt Solo auf (wie toggleSolo).
   * Ein stummgeschalteter Stem wird beim Solo automatisch wieder aktiviert.
   * @param {string|null} stemId
   */
  setSolo(stemId) {
    let next = stemId == null ? null : stemId;
    if (next !== null && !this._stems.has(next)) return;
    if (next !== null && next === this._soloId) next = null;
    if (next === this._soloId) return;
    this._soloId = next;
    if (next !== null) this._stems.get(next).enabled = true;
    this._applyGains();
    for (const stem of this._stems.values()) this._emitStem(stem);
  }

  toggleSolo(stemId) {
    this.setSolo(stemId);
  }

  isAudible(stemId) {
    const stem = this._stems.get(stemId);
    return !!stem && this._audible(stem);
  }

  /** Alle Stems aktivieren und Solo aufheben. */
  enableAll() {
    this._soloId = null;
    for (const stem of this._stems.values()) stem.enabled = true;
    this._applyGains();
    for (const stem of this._stems.values()) this._emitStem(stem);
  }

  /** Master-Lautstärke 0..1. */
  setMasterVolume(v) {
    const vol = clamp(Number(v) || 0, 0, 1);
    this._volume = vol;
    if (!this._master || !this._ctx) return;
    const g = this._master.gain;
    const t = this._ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.setTargetAtTime(vol, t, 0.02);
  }

  // ───────────────────────── Analyse ─────────────────────────

  /**
   * Geglätteter Pegel 0..1 des Stem-Signals (unabhängig von Mute/Solo).
   * Mehrfachaufrufe im selben Frame liefern den gecachten Wert.
   */
  getLevel(stemId) {
    const stem = this._stems.get(stemId);
    if (!stem) return 0;
    const t = nowMs();
    const dtMs = t - stem.levelT;
    if (stem.levelT && dtMs < 4) return stem.level;
    const dt = stem.levelT ? Math.min(0.25, dtMs / 1000) : 0.016;
    stem.levelT = t;

    let target = 0;
    let release = LEVEL_IDLE_RELEASE;
    if (this._playing && stem.buffer) {
      target = this._rms(stem);
      release = LEVEL_RELEASE;
    }
    const tau = target > stem.level ? LEVEL_ATTACK : release;
    stem.level += (target - stem.level) * (1 - Math.exp(-dt / tau));
    if (stem.level < 1e-4) stem.level = 0;
    return stem.level;
  }

  /**
   * Wellenform-Peaks (max |Sample| pro Bucket über alle Kanäle), normiert auf
   * das Absolutmaximum aller Stems des Songs. Gecacht pro (stemId, buckets);
   * das zurückgegebene Array nicht verändern.
   * @returns {Float32Array} Werte 0..1
   */
  getPeaks(stemId, buckets) {
    const n = Math.max(1, Math.floor(Number(buckets)) || 1);
    const stem = this._stems.get(stemId);
    if (!stem || !stem.buffer) return new Float32Array(n);
    const key = `${stemId}:${n}`;
    const cached = this._peakCache.get(key);
    if (cached) return cached;

    const buf = stem.buffer;
    const total = Math.max(buf.length, Math.round(this._duration * buf.sampleRate));
    const peaks = bucketPeaks(buf, n, total);
    const norm = this._getSongPeak();
    if (norm > 0) {
      const inv = 1 / norm;
      for (let i = 0; i < n; i++) peaks[i] = Math.min(1, peaks[i] * inv);
    }
    this._peakCache.set(key, peaks);
    return peaks;
  }

  // ───────────────────────── Intern ─────────────────────────

  _ensureContext() {
    if (this._ctx) return this._ctx;
    const Ctor = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Ctor) return null;
    let ctx;
    try {
      // Handys: 32 kHz + Mono-Puffer -> ~1/3 des RAM (echte Songs mit 6 Stems würden sonst iOS-Safari sprengen)
      ctx = new Ctor(LITE_MODE ? { latencyHint: 'interactive', sampleRate: 32000 } : { latencyHint: 'interactive' });
    } catch {
      ctx = new Ctor();
    }

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -10;
    comp.knee.value = 12;
    comp.ratio.value = 3;
    comp.attack.value = 0.005;
    comp.release.value = 0.2;

    const master = ctx.createGain();
    master.gain.value = this._volume;
    const transport = ctx.createGain();
    const sink = ctx.createGain();
    sink.gain.value = 0;

    transport.connect(master);
    master.connect(comp);
    comp.connect(ctx.destination);
    sink.connect(ctx.destination);

    this._ctx = ctx;
    this._master = master;
    this._transport = transport;
    this._sink = sink;
    return ctx;
  }

  /** @returns {Stem} */
  _createStem(def) {
    const ctx = this._ctx;
    const gain = ctx.createGain();
    gain.gain.value = 1;
    gain.connect(this._transport);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = FFT_SIZE;
    analyser.connect(this._sink);
    return {
      id: def.id,
      def,
      enabled: true,
      buffer: null,
      gain,
      analyser,
      target: 1,
      timeBuf: new Float32Array(analyser.fftSize),
      byteBuf: null,
      level: 0,
      levelT: 0,
      maxAbs: -1,
    };
  }

  _teardownStems() {
    for (const stem of this._stems.values()) {
      safeDisconnect(stem.gain);
      safeDisconnect(stem.analyser);
    }
    this._stems.clear();
  }

  _audible(stem) {
    return stem.enabled && (this._soloId === null || this._soloId === stem.id);
  }

  /** Mute/Solo-Gains mit kurzer Rampe nachführen. */
  _applyGains() {
    if (!this._ctx) return;
    const t = this._ctx.currentTime;
    for (const stem of this._stems.values()) {
      const target = this._audible(stem) ? 1 : 0;
      if (target === stem.target) continue;
      stem.target = target;
      const g = stem.gain.gain;
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value, t);
      g.setTargetAtTime(target, t, MUTE_TC);
    }
  }

  /** Startet alle Stems gemeinsam bei identischer `when`-Zeit ab `offset`. */
  _startSources(offset) {
    const ctx = this._ctx;
    const when = ctx.currentTime + START_DELAY;
    const gen = ++this._playGen;

    const tg = this._transport.gain;
    tg.cancelScheduledValues(when);
    tg.setValueAtTime(0, when);
    tg.linearRampToValueAtTime(1, when + FADE_IN);

    const sources = [];
    for (const stem of this._stems.values()) {
      if (!stem.buffer || offset >= stem.buffer.duration) continue;
      const src = ctx.createBufferSource();
      src.buffer = stem.buffer;
      src.connect(stem.gain);
      src.connect(stem.analyser);
      src.onended = () => this._onSourceEnded(gen, src);
      src.start(when, offset);
      sources.push(src);
    }
    this._sources = sources;
    this._pending = sources.length;
    this._startAt = when;
    this._offset = offset;
  }

  /** Stoppt laufende Sources mit kurzer Ausblendung; ihr onended löst kein 'ended' aus. */
  _stopSources() {
    this._playGen++;
    const sources = this._sources;
    this._sources = [];
    this._pending = 0;
    if (!this._ctx || !sources.length) return;
    const t = this._ctx.currentTime;
    const tg = this._transport.gain;
    tg.cancelScheduledValues(t);
    tg.setValueAtTime(tg.value, t);
    tg.linearRampToValueAtTime(0, t + FADE_OUT);
    const stopAt = t + FADE_OUT + 0.005;
    for (const src of sources) {
      src.onended = () => safeDisconnect(src);
      try {
        src.stop(stopAt);
      } catch {
        safeDisconnect(src);
      }
    }
  }

  _onSourceEnded(gen, src) {
    safeDisconnect(src);
    if (gen !== this._playGen || !this._playing) return;
    if (--this._pending <= 0) this._finish();
  }

  /** Songende: Position auf 0, Wiedergabe aus, Events feuern. */
  _finish() {
    this._stopSources();
    this._playing = false;
    this._offset = 0;
    this._stopTimer();
    this._emit('statechange', { isPlaying: false });
    this._emit('ended', {});
    this._emit('timeupdate', { currentTime: 0 });
  }

  /** Wiedergabe sofort anhalten (ohne Positionsevent), z. B. beim Songwechsel. */
  _halt() {
    const was = this._playing;
    this._stopSources();
    this._playing = false;
    this._stopTimer();
    if (was) this._emit('statechange', { isPlaying: false });
  }

  _startTimer() {
    this._stopTimer();
    this._timer = setInterval(() => this._tick(), TICK_MS);
  }

  _stopTimer() {
    if (this._timer !== null) clearInterval(this._timer);
    this._timer = null;
  }

  _tick() {
    if (!this._playing || !this._ctx) return;
    // Fallback, falls onended ausbleibt (z. B. Hintergrund-Tab).
    const raw = this._offset + (this._ctx.currentTime - this._startAt);
    if (raw >= this._duration + 0.25) {
      this._finish();
      return;
    }
    this._emit('timeupdate', { currentTime: this.currentTime });
  }

  _rms(stem) {
    const a = stem.analyser;
    let sum = 0;
    let len;
    if (typeof a.getFloatTimeDomainData === 'function') {
      const buf = stem.timeBuf;
      a.getFloatTimeDomainData(buf);
      len = buf.length;
      for (let i = 0; i < len; i++) sum += buf[i] * buf[i];
    } else {
      const buf = stem.byteBuf || (stem.byteBuf = new Uint8Array(a.fftSize));
      a.getByteTimeDomainData(buf);
      len = buf.length;
      for (let i = 0; i < len; i++) {
        const v = (buf[i] - 128) / 128;
        sum += v * v;
      }
    }
    return Math.min(1, Math.sqrt(sum / len) * LEVEL_GAIN);
  }

  /** Absolutmaximum über alle geladenen Stems (gecacht). */
  _getSongPeak() {
    if (this._songPeak >= 0) return this._songPeak;
    let max = 0;
    for (const stem of this._stems.values()) {
      if (!stem.buffer) continue;
      if (stem.maxAbs < 0) stem.maxAbs = bufferMaxAbs(stem.buffer);
      if (stem.maxAbs > max) max = stem.maxAbs;
    }
    this._songPeak = max;
    return max;
  }

  _emitStem(stem) {
    this._emit('stemchange', {
      stemId: stem.id,
      enabled: stem.enabled,
      audible: this._audible(stem),
      soloId: this._soloId,
    });
  }

  _emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
}

// ───────────────────────── Helfer ─────────────────────────

/**
 * Speichersparmodus für Handys/Tablets (grober Zeiger oder ≤ 4 GB RAM).
 * Überschreibbar per URL: ?hq=1 (aus) bzw. ?lite=1 (an).
 */
const LITE_MODE = (() => {
  try {
    const q = new URLSearchParams(globalThis.location?.search || '');
    if (q.has('hq')) return false;
    if (q.has('lite')) return true;
    const coarse = globalThis.matchMedia?.('(pointer: coarse)').matches;
    const lowMem = typeof navigator !== 'undefined' && navigator.deviceMemory && navigator.deviceMemory <= 4;
    return Boolean(coarse || lowMem);
  } catch {
    return false;
  }
})();

/** Mischt einen AudioBuffer auf Mono herunter (halber Speicher). */
function toMono(ctx, buf) {
  if (buf.numberOfChannels < 2) return buf;
  const out = ctx.createBuffer(1, buf.length, buf.sampleRate);
  const dst = out.getChannelData(0);
  const l = buf.getChannelData(0);
  const r = buf.getChannelData(1);
  for (let i = 0; i < dst.length; i++) dst[i] = (l[i] + r[i]) * 0.5;
  return out;
}

function safeDisconnect(node) {
  try {
    node.disconnect();
  } catch {
    /* bereits getrennt */
  }
}

/** Wie fetchArrayBuffer, aber mit bis zu 2 Wiederholungen bei Netzfehlern (wackeliges Schul-WLAN). */
async function fetchArrayBuffer(url, signal, onFrac) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetchArrayBufferOnce(url, signal, onFrac);
    } catch (err) {
      if (signal?.aborted || attempt >= 2 || /HTTP 4\d\d/.test(err?.message)) throw err;
      onFrac(0);
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
  }
}

/** Lädt eine Datei als ArrayBuffer; meldet Fortschritt 0..1, wenn content-length bekannt ist. */
async function fetchArrayBufferOnce(url, signal, onFrac) {
  const res = await fetch(url, signal ? { signal } : undefined);
  if (!res.ok) throw new Error(`HTTP ${res.status} für ${url}`);
  const total = Number(res.headers.get('content-length')) || 0;
  if (!total || !res.body || typeof res.body.getReader !== 'function') {
    const ab = await res.arrayBuffer();
    onFrac(1);
    return ab;
  }
  const reader = res.body.getReader();
  const chunks = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    onFrac(Math.min(1, loaded / total));
  }
  const out = new Uint8Array(loaded);
  let pos = 0;
  for (const c of chunks) {
    out.set(c, pos);
    pos += c.byteLength;
  }
  onFrac(1);
  return out.buffer;
}

/** decodeAudioData mit Promise- und Callback-Variante (ältere Safari-Versionen). */
function decodeAudio(ctx, data) {
  return new Promise((resolve, reject) => {
    try {
      const p = ctx.decodeAudioData(data, resolve, reject);
      if (p && typeof p.then === 'function') p.then(resolve, reject);
    } catch (err) {
      reject(err);
    }
  });
}

/** Max |Sample| pro Bucket über alle Kanäle; `total` = Länge in Samples, auf die verteilt wird. */
function bucketPeaks(buffer, buckets, total) {
  const out = new Float32Array(buckets);
  const len = buffer.length;
  const channels = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c));
  for (let i = 0; i < buckets; i++) {
    const s = Math.floor((i * total) / buckets);
    if (s >= len) break;
    const e = Math.min(len, Math.max(s + 1, Math.floor(((i + 1) * total) / buckets)));
    let m = 0;
    for (const data of channels) {
      for (let j = s; j < e; j++) {
        const v = data[j] < 0 ? -data[j] : data[j];
        if (v > m) m = v;
      }
    }
    out[i] = m;
  }
  return out;
}

function bufferMaxAbs(buffer) {
  let m = 0;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c);
    for (let j = 0; j < data.length; j++) {
      const v = data[j] < 0 ? -data[j] : data[j];
      if (v > m) m = v;
    }
  }
  return m;
}
