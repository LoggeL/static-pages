function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

/**
 * Multi-stem synchronized Web Audio playback engine with per-stem analysers,
 * smooth click-free gain ramps, solo/mute state management, and AbortController cancellation.
 */
export class StemAudioEngine {
  constructor({ onState, onTime, onLoad, onEnded } = {}) {
    this.callbacks = { onState, onTime, onLoad, onEnded };
    this.context = null;
    this.masterGain = null;
    this.buffers = new Map();
    this.stemNodes = new Map();
    this.sources = [];
    this.availableStemIds = [];
    this.muted = {};
    this.soloId = null;
    this.preSoloMuted = null;
    this.volumes = {};
    this.manifest = null;
    this.manifestDuration = 0;
    this.generation = 0;
    this.loading = null;
    this.frame = null;
    this.offset = 0;
    this.startedAt = 0;
    this.playing = false;
    this.disposed = false;
  }

  get duration() {
    if (this.buffers.size > 0) {
      let max = 0;
      for (const buffer of this.buffers.values()) {
        if (buffer.duration > max) max = buffer.duration;
      }
      return max;
    }
    return this.manifestDuration || 0;
  }

  get currentTime() {
    const elapsed =
      this.playing && this.context
        ? Math.max(0, this.context.currentTime - this.startedAt)
        : 0;
    return Math.max(0, Math.min(this.duration, this.offset + elapsed));
  }

  ensureContext() {
    if (this.disposed) {
      throw new Error('StemAudioEngine has been disposed');
    }
    if (this.context) return this.context;

    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) {
      throw new Error('Web Audio API wird in diesem Browser nicht unterstützt');
    }

    const context = new AudioCtx();
    const masterGain = context.createGain();
    masterGain.gain.setValueAtTime(1, context.currentTime);
    masterGain.connect(context.destination);

    this.context = context;
    this.masterGain = masterGain;
    return context;
  }

  /**
   * Synchronously initializes/resumes AudioContext inside a user tap/click handler
   * to satisfy iOS Safari and mobile Chrome autoplay policies.
   */
  async activate() {
    if (this.disposed) return;
    const context = this.ensureContext();
    if (context.state === 'suspended' || context.state === 'interrupted') {
      await context.resume();
    }
  }

  emitState() {
    if (!this.disposed) {
      this.callbacks.onState?.(this.getState());
    }
  }

  emitLoad(loadState) {
    if (!this.disposed) {
      this.callbacks.onLoad?.(loadState);
    }
  }

  clearStemNodes() {
    for (const { analyser, gain } of this.stemNodes.values()) {
      try {
        analyser.disconnect();
      } catch {
        // Ignore disconnect errors during teardown.
      }
      try {
        gain.disconnect();
      } catch {
        // Ignore disconnect errors during teardown.
      }
    }
    this.stemNodes.clear();
  }

  setupStemNodes(stemIds) {
    this.clearStemNodes();
    if (!this.context || !this.masterGain) return;

    const now = this.context.currentTime;
    for (const stemId of stemIds) {
      const analyser = this.context.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.75;

      const gain = this.context.createGain();
      gain.gain.setValueAtTime(this.getEffectiveGain(stemId), now);

      analyser.connect(gain);
      gain.connect(this.masterGain);

      this.stemNodes.set(stemId, {
        analyser,
        gain,
        timeDomainData: new Uint8Array(analyser.fftSize),
      });
    }
  }

  getEffectiveGain(stemId) {
    if (!this.availableStemIds.includes(stemId)) return 0;
    if (this.soloId !== null) {
      return stemId === this.soloId ? clamp01(this.volumes[stemId] ?? 1) : 0;
    }
    return this.muted[stemId] ? 0 : clamp01(this.volumes[stemId] ?? 1);
  }

  applyAllGains(immediate = false) {
    if (!this.context) return;
    const now = this.context.currentTime;
    const canRamp = !immediate && this.playing && this.context.state === 'running';

    for (const [stemId, node] of this.stemNodes.entries()) {
      const target = this.getEffectiveGain(stemId);
      const param = node.gain.gain;
      if (canRamp) {
        if (typeof param.cancelAndHoldAtTime === 'function') {
          param.cancelAndHoldAtTime(now);
        }
        param.setTargetAtTime(target, now, 0.018);
      } else {
        param.cancelScheduledValues(now);
        param.setValueAtTime(target, now);
      }
    }
  }

  stopSources() {
    for (const { source } of this.sources) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        // Already stopped.
      }
      try {
        source.disconnect();
      } catch {
        // Already disconnected.
      }
    }
    this.sources = [];

    if (this.frame !== null) {
      cancelAnimationFrame(this.frame);
      this.frame = null;
    }
    this.playing = false;
  }

  async loadSong(manifest) {
    if (this.disposed) return false;

    const version = ++this.generation;
    this.loading?.abort();
    this.loading = null;

    this.stopSources();
    // Explicitly release prior decoded AudioBuffers before fetching a new song (iOS Safari RAM limit).
    this.buffers.clear();
    this.clearStemNodes();

    this.offset = 0;
    this.startedAt = 0;
    this.playing = false;

    const stems = Array.isArray(manifest?.stems) ? manifest.stems : [];
    this.manifest = manifest || null;
    this.manifestDuration = Number.isFinite(manifest?.duration)
      ? Math.max(0, manifest.duration)
      : 0;
    this.availableStemIds = stems.map((s) => s.id);
    this.muted = {};
    this.volumes = {};
    this.soloId = null;
    this.preSoloMuted = null;

    for (const stemId of this.availableStemIds) {
      this.muted[stemId] = false;
      this.volumes[stemId] = 1;
    }

    this.emitState();
    this.callbacks.onTime?.(0);

    if (stems.length === 0) {
      this.emitLoad({ status: 'ready', progress: 100, decodedStems: 0, totalStems: 0 });
      return true;
    }

    const controller = new AbortController();
    this.loading = controller;
    const { signal } = controller;

    this.emitLoad({ status: 'loading', progress: 0, decodedStems: 0, totalStems: stems.length });

    try {
      const context = this.ensureContext();
      const transfers = stems.map(() => ({
        loaded: 0,
        total: 0,
        done: false,
        decoded: false,
      }));

      const reportProgress = () => {
        if (signal.aborted || version !== this.generation || this.disposed) return;

        if (transfers.every((t) => t.done)) {
          const decodedCount = transfers.filter((t) => t.decoded).length;
          this.emitLoad({
            status: 'decoding',
            progress: null,
            decodedStems: decodedCount,
            totalStems: stems.length,
          });
          return;
        }

        const allKnown = transfers.every((t) => t.total > 0);
        const loadedBytes = transfers.reduce((sum, t) => sum + t.loaded, 0);
        const totalBytes = transfers.reduce((sum, t) => sum + t.total, 0);
        const progress = allKnown
          ? Math.min(99, Math.floor((loadedBytes / totalBytes) * 100))
          : null;

        this.emitLoad({
          status: 'loading',
          progress,
          decodedStems: 0,
          totalStems: stems.length,
        });
      };

      const loadOneStem = async (stem, index) => {
        const response = await fetch(stem.url, { signal });
        if (!response.ok) {
          throw new Error(`Audio-Spur nicht verfügbar (${response.status}): ${stem.label || stem.id}`);
        }

        const transfer = transfers[index];
        const rawLength = Number(response.headers.get('Content-Length'));
        const hasContentEncoding = Boolean(response.headers.get('Content-Encoding'));
        transfer.total =
          Number.isFinite(rawLength) && rawLength > 0 && !hasContentEncoding ? rawLength : 0;
        reportProgress();

        let arrayBuffer;
        if (response.body) {
          const reader = response.body.getReader();
          const chunks = [];
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (signal.aborted || version !== this.generation || this.disposed) {
                throw new DOMException('Load cancelled', 'AbortError');
              }
              if (done) break;
              chunks.push(value);
              transfer.loaded += value.byteLength;
              reportProgress();
            }
          } finally {
            reader.releaseLock();
          }

          const merged = new Uint8Array(transfer.loaded);
          let writeOffset = 0;
          for (const chunk of chunks) {
            merged.set(chunk, writeOffset);
            writeOffset += chunk.byteLength;
          }
          arrayBuffer = merged.buffer;
        } else {
          arrayBuffer = await response.arrayBuffer();
          transfer.loaded = arrayBuffer.byteLength;
        }

        if (signal.aborted || version !== this.generation || this.disposed) {
          throw new DOMException('Load cancelled', 'AbortError');
        }

        transfer.done = true;
        reportProgress();

        const audioBuffer = await context.decodeAudioData(arrayBuffer);
        if (signal.aborted || version !== this.generation || this.disposed) {
          throw new DOMException('Load cancelled', 'AbortError');
        }

        transfer.decoded = true;
        reportProgress();
        return { stemId: stem.id, audioBuffer };
      };

      const decoded = await Promise.all(stems.map((stem, idx) => loadOneStem(stem, idx)));

      if (version !== this.generation || this.disposed || signal.aborted) {
        return false;
      }

      for (const { stemId, audioBuffer } of decoded) {
        this.buffers.set(stemId, audioBuffer);
      }

      this.setupStemNodes(this.availableStemIds);
      this.applyAllGains(true);

      this.emitLoad({
        status: 'ready',
        progress: 100,
        decodedStems: stems.length,
        totalStems: stems.length,
      });
      this.emitState();
      return true;
    } catch (error) {
      if (version !== this.generation || this.disposed || signal.aborted) {
        return false;
      }
      controller.abort();
      this.stopSources();
      this.buffers.clear();
      this.clearStemNodes();
      this.emitLoad({ status: 'error', progress: null, error });
      this.emitState();
      throw error;
    } finally {
      if (this.loading === controller) {
        this.loading = null;
      }
    }
  }

  startPlayback(startOffset) {
    if (!this.context || this.buffers.size === 0 || this.disposed) return;

    this.stopSources();

    const dur = this.duration;
    this.offset = Math.max(0, Math.min(dur, startOffset));
    this.startedAt = this.context.currentTime;
    this.applyAllGains(true);

    let longestEntry = null;
    const pendingSources = [];

    for (const stemId of this.availableStemIds) {
      const buffer = this.buffers.get(stemId);
      if (!buffer || this.offset >= buffer.duration) continue;

      const source = this.context.createBufferSource();
      source.buffer = buffer;
      const node = this.stemNodes.get(stemId);
      source.connect(node ? node.analyser : this.masterGain);

      const entry = { stemId, source, buffer };
      pendingSources.push(entry);
      if (!longestEntry || buffer.duration > longestEntry.buffer.duration) {
        longestEntry = entry;
      }
    }

    if (pendingSources.length === 0) {
      this.offset = dur;
      this.playing = false;
      this.emitState();
      this.callbacks.onTime?.(dur);
      this.callbacks.onEnded?.();
      return;
    }

    longestEntry.source.onended = () => {
      if (!this.playing || this.disposed) return;
      this.offset = this.duration;
      this.stopSources();
      this.emitState();
      this.callbacks.onTime?.(this.duration);
      this.callbacks.onEnded?.();
    };

    this.sources = pendingSources;
    this.playing = true;

    for (const { source } of this.sources) {
      source.start(this.startedAt, this.offset);
    }

    this.emitState();
    this.callbacks.onTime?.(this.offset);

    const tick = () => {
      if (!this.playing || this.disposed) return;
      this.callbacks.onTime?.(this.currentTime);
      if (this.playing && !this.disposed) {
        this.frame = requestAnimationFrame(tick);
      }
    };
    this.frame = requestAnimationFrame(tick);
  }

  async play() {
    if (this.disposed) return false;
    const context = this.ensureContext();
    if (context.state === 'suspended' || context.state === 'interrupted') {
      await context.resume();
    }
    if (this.disposed || this.buffers.size === 0) return false;
    if (this.playing) return true;

    const startOffset = this.offset >= this.duration ? 0 : this.offset;
    this.startPlayback(startOffset);
    return true;
  }

  pause() {
    if (this.disposed) return;
    if (this.playing) {
      this.offset = this.currentTime;
    }
    this.stopSources();
    this.emitState();
    this.callbacks.onTime?.(this.offset);
  }

  seek(seconds) {
    if (this.disposed || !Number.isFinite(seconds)) return;
    const target = Math.max(0, Math.min(this.duration, seconds));
    if (this.playing && this.buffers.size > 0) {
      this.startPlayback(target);
    } else {
      this.offset = target;
      this.emitState();
      this.callbacks.onTime?.(target);
    }
  }

  toggleMute(stemId) {
    if (!this.availableStemIds.includes(stemId)) return;
    if (this.soloId !== null) {
      this.soloId = null;
      this.preSoloMuted = null;
    }
    this.muted[stemId] = !this.muted[stemId];
    this.applyAllGains(false);
    this.emitState();
  }

  setMuted(stemId, muted) {
    if (!this.availableStemIds.includes(stemId)) return;
    if (this.soloId !== null) {
      this.soloId = null;
      this.preSoloMuted = null;
    }
    this.muted[stemId] = Boolean(muted);
    this.applyAllGains(false);
    this.emitState();
  }

  toggleSolo(stemId) {
    if (!this.availableStemIds.includes(stemId)) return;

    if (this.soloId === stemId) {
      this.soloId = null;
      if (this.preSoloMuted) {
        for (const id of this.availableStemIds) {
          this.muted[id] = Boolean(this.preSoloMuted[id]);
        }
      }
      this.preSoloMuted = null;
    } else {
      if (this.soloId === null) {
        this.preSoloMuted = { ...this.muted };
      }
      this.soloId = stemId;
      for (const id of this.availableStemIds) {
        this.muted[id] = id !== stemId;
      }
    }

    this.applyAllGains(false);
    this.emitState();
  }

  setStemVolume(stemId, volume01) {
    if (!this.availableStemIds.includes(stemId)) return;
    this.volumes[stemId] = clamp01(Number.isFinite(volume01) ? volume01 : 1);
    this.applyAllGains(false);
    this.emitState();
  }

  unmuteAll() {
    this.soloId = null;
    this.preSoloMuted = null;
    for (const id of this.availableStemIds) {
      this.muted[id] = false;
    }
    this.applyAllGains(false);
    this.emitState();
  }

  getState() {
    return {
      isPlaying: this.playing,
      currentTime: this.currentTime,
      duration: this.duration,
      muted: { ...this.muted },
      soloId: this.soloId,
      volumes: { ...this.volumes },
      availableStemIds: [...this.availableStemIds],
    };
  }

  getStemLevels() {
    const levels = {};
    const rawLevels = {};
    let sum = 0;
    const count = this.availableStemIds.length;

    for (const stemId of this.availableStemIds) {
      const node = this.stemNodes.get(stemId);
      let raw = 0;

      if (this.playing && node) {
        const buf = node.timeDomainData;
        node.analyser.getByteTimeDomainData(buf);
        let sumSq = 0;
        for (let i = 0; i < buf.length; i += 1) {
          const sample = (buf[i] - 128) / 128;
          sumSq += sample * sample;
        }
        const rms = Math.sqrt(sumSq / buf.length);
        raw = Math.min(1, rms * 3.0);
      }

      rawLevels[stemId] = raw;
      const effectiveGain = this.getEffectiveGain(stemId);
      const level = this.playing && effectiveGain > 0.01 ? Math.min(1, raw * effectiveGain) : 0;
      levels[stemId] = level;
      sum += level;
    }

    const totalEnergy = this.playing && count > 0 ? Math.min(1, sum / count) : 0;
    return { levels, rawLevels, totalEnergy };
  }

  dispose() {
    this.disposed = true;
    ++this.generation;
    this.loading?.abort();
    this.loading = null;
    this.stopSources();
    this.buffers.clear();
    this.clearStemNodes();
    try {
      this.masterGain?.disconnect();
    } catch {
      // Ignore disconnect errors during dispose.
    }
    this.masterGain = null;
    if (this.context && this.context.state !== 'closed') {
      void this.context.close().catch(() => {});
    }
    this.context = null;
  }
}
