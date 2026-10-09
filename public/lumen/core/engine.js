// LUMEN playback engine: cue tracking with fade/delay, effect engine, executors (HTP/LTP), programmer,
// grandmaster/blackout and DMX buffers. Pure logic, importable in Node.

import { ATTR_KEYS, DISCRETE, defaultsFor, constrain, writeDMX } from "./fixtures.js";

const KEYS = ATTR_KEYS;
const A = KEYS.length;
const KI = Object.fromEntries(KEYS.map((k, i) => [k, i]));
const DISC = Uint8Array.from(KEYS, (k) => (DISCRETE.has(k) ? 1 : 0));
const COLOR_KEY = { r: 1, g: 1, b: 1, w: 1 };
const TAU = Math.PI * 2;
const ONSET_DECAY = 0.11; // s
const frac = (x) => x - Math.floor(x);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const hash = (n) => frac(Math.sin(n * 127.1 + 311.7) * 43758.5453);

// h 0..1, s, v → writes into out[0..2] (no allocation)
function hsvInto(h, s, v, out) {
  h = frac(h) * 6;
  const i = Math.floor(h), f = h - i, p = v * (1 - s), q = v * (1 - s * f), u = v * (1 - s * (1 - f));
  switch (i % 6) {
    case 0: out[0] = v; out[1] = u; out[2] = p; break;
    case 1: out[0] = q; out[1] = v; out[2] = p; break;
    case 2: out[0] = p; out[1] = v; out[2] = u; break;
    case 3: out[0] = p; out[1] = q; out[2] = v; break;
    case 4: out[0] = u; out[1] = p; out[2] = v; break;
    default: out[0] = v; out[1] = p; out[2] = q;
  }
  return out;
}

// pixels follow the fixture colour with weight w (used whenever r/g/b are written by something other than a pixel effect)
function pixelsToward(a, w) {
  const px = a.pixels;
  if (!px) return;
  for (let i = 0; i < px.length; i++) {
    const p = px[i];
    p.r += (a.r - p.r) * w; p.g += (a.g - p.g) * w; p.b += (a.b - p.b) * w; p.dim += (1 - p.dim) * w;
  }
}

export function createEngine(state) {
  let dirty = true, ver = 0;
  let fx = [], N = 0, fIndex = new Map(), objs = [];
  let base = new Float64Array(0), cur = new Float64Array(0);
  let cues = [], tracked = [], changed = [], isSet = [], starts = null, fades = null, ends = null, fxCue = null, maxSpan = 0;
  const idxCache = new WeakMap(), valCache = new WeakMap();
  const xs = [], pool = [], rgb = [0, 0, 0];
  const env = { rms: 0, low: 0, mid: 0, high: 0 };
  const frame = { t: 0, beat: 0, bar: 1, barBeat: 1, bpm: 120, attrs: {}, dmx: {}, cueId: null, nextCueId: null, env, onset: 0 };

  state.on("show:changed", () => { dirty = true; });

  // {id: attrs} with group keys expanded (group entries first, fixture keys win) → Map(fixtureIndex → merged attrs)
  function expand(values) {
    const out = new Map();
    const ent = Object.entries(values || {});
    for (const pass of [true, false]) {
      for (const [id, v] of ent) {
        const isG = state.isGroup(id);
        if (isG !== pass || !v) continue;
        for (const fid of isG ? state.resolve([id]) : [id]) {
          const fi = fIndex.get(fid);
          if (fi === undefined) continue;
          if (!out.has(fi)) out.set(fi, {});
          Object.assign(out.get(fi), v);
        }
      }
    }
    return out;
  }

  function rebuild() {
    dirty = false; ver++;
    fx = state.show.fixtures; N = fx.length;
    fIndex = new Map(fx.map((f, i) => [f.id, i]));
    base = new Float64Array(N * A); cur = new Float64Array(N * A);
    frame.attrs = {}; objs = [];
    fx.forEach((f, i) => {
      const d = defaultsFor(f.type);
      for (let k = 0; k < A; k++) base[i * A + k] = d[KEYS[k]];
      objs.push(d);
      frame.attrs[f.id] = d;
    });
    cues = state.show.cues;
    const C = cues.length;
    tracked = []; changed = []; isSet = [];
    starts = new Float64Array(C); fades = new Float64Array(C); ends = new Float64Array(C); fxCue = new Int32Array(C);
    maxSpan = 0;
    let prev = base, prevSet = new Uint8Array(N * A);
    for (let j = 0; j < C; j++) {
      const c = cues[j];
      const tr = c.block ? Float64Array.from(base) : Float64Array.from(prev);
      const set = c.block ? new Uint8Array(N * A) : Uint8Array.from(prevSet);
      const ex = new Uint8Array(N * A);
      for (const id of c.kill || []) {
        if (id === "fx") continue;
        for (const fid of state.resolve([id])) {
          const fi = fIndex.get(fid);
          for (let k = 0; k < A; k++) { tr[fi * A + k] = base[fi * A + k]; set[fi * A + k] = 0; }
        }
      }
      for (const [fi, o] of expand(c.values)) {
        for (const key in o) {
          const k = KI[key], v = o[key];
          if (k === undefined || typeof v !== "number" || Number.isNaN(v)) continue;
          const x = fi * A + k;
          tr[x] = v; set[x] = 1; ex[x] = 1;
        }
      }
      const ch = new Uint8Array(N * A);
      for (let x = 0; x < N * A; x++) ch[x] = ex[x] || tr[x] !== prev[x] ? 1 : 0;
      tracked.push(tr); changed.push(ch); isSet.push(set);
      const delay = Math.max(0, c.delay || 0), fade = Math.max(0, c.fade || 0);
      starts[j] = c.time + delay; fades[j] = fade; ends[j] = c.time + delay + fade;
      maxSpan = Math.max(maxSpan, delay + fade);
      const fxDef = (c.effects && c.effects.length) || c.block || (c.kill || []).includes("fx");
      fxCue[j] = fxDef ? j : j ? fxCue[j - 1] : -1;
      prev = tr; prevSet = set;
    }
  }

  const progress = (j, t) => (fades[j] > 0 ? clamp01((t - starts[j]) / fades[j]) : t >= starts[j] ? 1 : 0);

  // cue tracking + fades at time t into `out` (Float64Array N*A); returns the active cue index
  function trackInto(t, out) {
    const k = state.cueIndexAt(t);
    if (k < 0) { out.set(base); return k; }
    let j0 = -1;
    for (let j = k; j >= 0 && cues[j].time >= t - maxSpan - 1e-9; j--) if (ends[j] > t) j0 = j;
    if (j0 < 0) { out.set(tracked[k]); return k; }
    out.set(j0 > 0 ? tracked[j0 - 1] : base);
    for (let j = j0; j <= k; j++) {
      const p = progress(j, t), tr = tracked[j], ch = changed[j];
      const started = t >= starts[j];
      for (let x = 0; x < out.length; x++) {
        if (!ch[x]) continue;
        if (DISC[x % A]) { if (started) out[x] = tr[x]; } else out[x] += (tr[x] - out[x]) * p;
      }
    }
    return k;
  }

  // effect targets → fixture indices (cached per effect object, invalidated on show change or target edit)
  function targetsOf(e) {
    let c = idxCache.get(e);
    const key = e.targets ? e.targets.join("|") : "";
    if (!c || c.v !== ver || c.key !== key) {
      c = { v: ver, key, idx: state.resolve(e.targets || []).map((id) => fIndex.get(id)).filter((i) => i !== undefined) };
      idxCache.set(e, c);
    }
    return c.idx;
  }

  function envAt(arr, hop, t) {
    if (!arr || !arr.length) return 0;
    const x = t / hop, i = Math.floor(x);
    if (i < 0) return arr[0];
    if (i >= arr.length - 1) return arr[arr.length - 1];
    return arr[i] + (arr[i + 1] - arr[i]) * (x - i);
  }

  let onsetPtr = -1;
  function updateAudio(t, beat) {
    const an = state.analysis;
    const e = an && an.env;
    const hop = (e && e.hop) || 0.1;
    env.rms = envAt(e && e.rms, hop, t); env.low = envAt(e && e.low, hop, t);
    env.mid = envAt(e && e.mid, hop, t); env.high = envAt(e && e.high, hop, t);
    const on = an && an.percOnsets;
    if (!on || !on.length) { frame.onset = Math.exp(-frac(beat) * 4); return; }
    if (onsetPtr >= on.length || (onsetPtr >= 0 && on[onsetPtr] > t) || (onsetPtr >= 0 && t - on[onsetPtr] > 2)) {
      let lo = 0, hi = on.length - 1;
      onsetPtr = -1;
      while (lo <= hi) { const m = (lo + hi) >> 1; if (on[m] <= t) { onsetPtr = m; lo = m + 1; } else hi = m - 1; }
    }
    while (onsetPtr + 1 < on.length && on[onsetPtr + 1] <= t) onsetPtr++;
    if (onsetPtr < 0) { frame.onset = 0; return; }
    const o = on[onsetPtr];
    const strength = clamp01(0.35 + envAt(e && e.low, hop, o) * 0.8); // strong kick hits flash brighter
    frame.onset = Math.exp(-(t - o) / ONSET_DECAY) * strength;
  }

  function dimForm(e, ph, i, baseV) {
    const duty = e.duty ?? 0.5;
    switch (e.form) {
      case "sine": return 0.5 - 0.5 * Math.cos(TAU * ph);
      case "ramp": return ph;
      case "rampDown": return 1 - ph;
      case "square": return ph < duty ? 1 : 0;
      case "pulse": return ph < duty ? 1 - ph / duty : 0;
      case "chase": return ph < duty ? 1 - (ph / duty) ** 2 : 0;
      case "random": return hash(Math.floor(baseV) * 17.13 + i * 3.71) < duty ? 1 : 0;
      case "env": return env[e.band] ?? env.low;
      case "onset": return frame.onset;
      default: return 0;
    }
  }

  // apply a list of effects with weight w (0..1) onto objs
  function applyEffects(list, w, t, beat) {
    if (!list || !list.length || w <= 0) return;
    for (let q = 0; q < list.length; q++) {
      const e = list[q];
      const idx = targetsOf(e), n = idx.length;
      if (!n) continue;
      const baseV = (e.sync === "free" ? t : beat) * (e.speed ?? 1);
      const dir = e.dir < 0 ? -1 : 1, spread = (e.phase || 0) / 360, off = (e.offset || 0) / 360;
      if (e.type === "pixel") { pixelEffect(e, idx, w, baseV, dir, spread, off); continue; }
      const W = e.wings | 0, m = W > 1 ? Math.ceil(n / W) : n;
      for (let i = 0; i < n; i++) {
        let ii = i;
        if (W > 1) { ii = i % m; if (Math.floor(i / m) % 2) ii = m - 1 - ii; }
        const ph = frac(baseV + (dir * ii / m) * spread + off);
        const a = objs[idx[i]];
        if (e.type === "dim") {
          const v = (e.low ?? 0) + ((e.high ?? 1) - (e.low ?? 0)) * dimForm(e, ph, i, baseV);
          const nd = e.mode === "abs" ? v : e.mode === "add" ? Math.min(1, a.dim + v) : a.dim * v;
          a.dim += (nd - a.dim) * w;
        } else if (e.type === "position") {
          const s = (e.size ?? 30) * w, c = TAU * ph;
          switch (e.form) {
            case "circle": a.pan += s * Math.sin(c); a.tilt += s * Math.cos(c); break;
            case "eight": a.pan += s * Math.sin(c); a.tilt += s * 0.5 * Math.sin(2 * c); break;
            case "pan": a.pan += s * Math.sin(c); break;
            case "tilt": a.tilt += s * Math.sin(c); break;
            case "wave": a.tilt += s * Math.sin(c); a.pan += s * 0.35 * Math.cos(c); break;
            case "fan": a.pan += s * (m > 1 ? (ii / (m - 1)) * 2 - 1 : 0) * (0.5 - 0.5 * Math.cos(TAU * frac(baseV))); break;
          }
        } else if (e.type === "color") {
          const cols = e.colors && e.colors.length ? e.colors : null;
          if (e.form === "rainbow" || !cols) hsvInto(ph, e.sat ?? 1, 1, rgb);
          else { const c = cols[Math.floor(ph * cols.length) % cols.length]; rgb[0] = c[0]; rgb[1] = c[1]; rgb[2] = c[2]; }
          a.r += (rgb[0] - a.r) * w; a.g += (rgb[1] - a.g) * w; a.b += (rgb[2] - a.b) * w; a.w -= a.w * w;
          pixelsToward(a, w);
        }
      }
    }
  }

  // all target bars form one continuous pixel strip
  function pixelEffect(e, idx, w, baseV, dir, spread, off) {
    let total = 0;
    for (let i = 0; i < idx.length; i++) total += objs[idx[i]].pixels ? objs[idx[i]].pixels.length : 0;
    if (!total) return;
    const cols = e.colors && e.colors.length ? e.colors : [[1, 1, 1]];
    const fg = cols[0], bg = cols[1] || null, size = Math.max(0.01, e.size ?? 0.35);
    let j = 0;
    for (let i = 0; i < idx.length; i++) {
      const px = objs[idx[i]].pixels;
      if (!px) continue;
      for (let p = 0; p < px.length; p++, j++) {
        const x = j / total, ph = frac(baseV + dir * x * spread + off);
        let v;
        switch (e.form) {
          case "chase": v = ph < size ? 1 - ph / size : 0; break;
          case "wave": v = 0.5 - 0.5 * Math.cos(TAU * ph); break;
          case "sparkle": v = hash(Math.floor(baseV * 4) * 13.1 + j * 1.7) < size * 0.5 ? 1 : 0; break;
          case "fill": v = x < frac(baseV) ? 1 : 0; break;
          default: v = 1;
        }
        let r, g, b, d;
        if (e.form === "rainbow") { hsvInto(ph, e.sat ?? 1, 1, rgb); r = rgb[0]; g = rgb[1]; b = rgb[2]; d = 1; }
        else if (bg) { r = bg[0] + (fg[0] - bg[0]) * v; g = bg[1] + (fg[1] - bg[1]) * v; b = bg[2] + (fg[2] - bg[2]) * v; d = 1; }
        else { r = fg[0]; g = fg[1]; b = fg[2]; d = v; }
        const q = px[p];
        q.r += (r - q.r) * w; q.g += (g - q.g) * w; q.b += (b - q.b) * w; q.dim += (d - q.dim) * w;
      }
    }
  }

  // executor/programmer value tables: [{fi, keys:[], vals:[]}] cached per holder
  function valuesOf(holder) {
    let c = valCache.get(holder);
    if (!c || c.v !== ver || c.src !== holder.values) {
      const list = [];
      for (const [fi, o] of expand(holder.values)) {
        const keys = Object.keys(o).filter((k) => KI[k] !== undefined && typeof o[k] === "number");
        list.push({ fi, keys, vals: keys.map((k) => o[k]) });
      }
      c = { v: ver, src: holder.values, list };
      valCache.set(holder, c);
    }
    return c.list;
  }

  function executorLevel(x, ls, wall) {
    if (!ls) return 0;
    const dt = wall - ls.t;
    if (ls.active) return x.fade > 0 ? clamp01(dt / x.fade) : 1;
    return x.release > 0 ? 1 - clamp01(dt / x.release) : 0;
  }

  function evaluate(t, wall = (typeof performance !== "undefined" ? performance.now() : Date.now()) / 1000) {
    if (dirty) rebuild();
    const beat = state.beatAt(t);
    const bi = state.barAt(t);
    frame.t = t; frame.beat = beat; frame.bar = bi.bar; frame.barBeat = bi.beat; frame.bpm = state.bpmAt(t);
    updateAudio(t, beat);

    // 1. defaults → cue tracking + fades
    const k = trackInto(t, cur);
    frame.cueId = k >= 0 ? cues[k].id : null;
    frame.nextCueId = cues[k + 1] ? cues[k + 1].id : null;
    for (let i = 0; i < N; i++) {
      const a = objs[i], o = i * A;
      for (let q = 0; q < A; q++) a[KEYS[q]] = cur[o + q];
      if (a.pixels) pixelsToward(a, 1);
    }

    // 2. cue effects (crossfade from the previous effect set over the defining cue's fade)
    const fc = k >= 0 ? fxCue[k] : -1;
    if (fc >= 0) {
      const p = progress(fc, t), prev = fc > 0 ? fxCue[fc - 1] : -1;
      if (p < 1 && prev >= 0) applyEffects(cues[prev].effects, 1 - p, t, beat);
      applyEffects(cues[fc].effects, p, t, beat);
    }

    // 3. executors: dim HTP, rest LTP in activation order
    const live = state.live;
    let bo = 0;
    xs.length = 0;
    for (const x of state.show.executors) {
      const ls = live.executors[x.id];
      const lv = executorLevel(x, ls, wall);
      if (lv <= 0) continue;
      if (x.kind === "blackout") { bo = Math.max(bo, lv); continue; }
      const slot = pool[xs.length] || (pool[xs.length] = { x: null, lv: 0, t: 0 });
      slot.x = x; slot.lv = lv; slot.t = ls.t;
      xs.push(slot);
    }
    xs.sort((p, q) => p.t - q.t);
    for (const { x, lv } of xs) {
      for (const { fi, keys, vals } of valuesOf(x)) {
        const a = objs[fi];
        let col = false;
        for (let q = 0; q < keys.length; q++) {
          const key = keys[q], v = vals[q];
          if (key === "dim") a.dim = Math.max(a.dim, v * lv);
          else if (DISCRETE.has(key)) { if (lv >= 0.5) a[key] = v; }
          else { a[key] += (v - a[key]) * lv; if (COLOR_KEY[key]) col = true; }
        }
        if (col) pixelsToward(a, lv);
      }
      applyEffects(x.effects, lv, t, beat);
    }

    // 4. programmer values (LTP over everything) + programmer effects
    const pv = state.programmer.values;
    for (const id in pv) {
      const fi = fIndex.get(id);
      if (fi === undefined) continue;
      const a = objs[fi], v = pv[id];
      let col = false;
      for (const key in v) if (KI[key] !== undefined) { a[key] = v[key]; if (COLOR_KEY[key]) col = true; }
      if (col) pixelsToward(a, 1);
    }
    applyEffects(state.programmer.effects, 1, t, beat);

    // 5. constrain, master, blackout, DMX
    const gm = live.grandmaster ?? 1;
    for (let i = 0; i < N; i++) {
      const a = objs[i];
      constrain(fx[i], a);
      a.dim *= gm;
      if (live.blackout) a.dim = 0;
      else if (bo > 0) a.dim *= 1 - bo;
    }
    frame.dmx = writeDMX(fx, frame.attrs, frame.dmx);
    return frame;
  }

  function trackedAt(t) {
    if (dirty) rebuild();
    const buf = new Float64Array(N * A);
    const k = trackInto(t, buf);
    const out = {};
    if (k < 0) return out;
    const set = isSet[k];
    for (let i = 0; i < N; i++) {
      let o = null;
      for (let q = 0; q < A; q++) {
        if (!set[i * A + q]) continue;
        (o ||= {})[KEYS[q]] = buf[i * A + q];
      }
      if (o) out[fx[i].id] = o;
    }
    return out;
  }

  function activeCueAt(t) {
    if (dirty) rebuild();
    const k = state.cueIndexAt(t);
    if (k < 0) return { cue: null, index: -1, next: cues[0] || null, progress: 0 };
    return { cue: cues[k], index: k, next: cues[k + 1] || null, progress: progress(k, t) };
  }

  return {
    evaluate, trackedAt, activeCueAt,
    get frame() { return frame; },
    invalidate() { dirty = true; },
  };
}
