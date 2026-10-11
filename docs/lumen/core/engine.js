// LUMEN playback engine: cue tracking with fade/delay, effect engine, one-shot hits, executors (HTP/LTP),
// programmer, grandmaster/blackout and DMX buffers. Pure logic, importable in Node.

import { ATTR_KEYS, ATTRS, DISCRETE, defaultsFor, constrain, writeDMX } from "./fixtures.js";

const KEYS = ATTR_KEYS;
const A = KEYS.length;
const KI = Object.fromEntries(KEYS.map((k, i) => [k, i]));
const DISC = Uint8Array.from(KEYS, (k) => (DISCRETE.has(k) ? 1 : 0));
const COLOR_KEY = { r: 1, g: 1, b: 1, w: 1 };
const TAU = Math.PI * 2;
const ONSET_DECAY = 0.11; // s
const STEP_DECAY = 0.25; // s, onsetStep default
const PATTERN_DECAY = 0.12; // s
const HIT_DECAY = 0.25; // s
const HIT_TAIL = 6; // hits are evaluated for hold + 6·decay
const frac = (x) => x - Math.floor(x);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const hash = (n) => frac(Math.sin(n * 127.1 + 311.7) * 43758.5453);
const num = (v, d) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const sstep = (x) => x * x * (3 - 2 * x);

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
  if (!px || w <= 0) return;
  for (let i = 0; i < px.length; i++) {
    const p = px[i];
    p.r += (a.r - p.r) * w; p.g += (a.g - p.g) * w; p.b += (a.b - p.b) * w; p.dim += (1 - p.dim) * w;
  }
}

// step pattern string → per step {lvl, back, hold}: level of the governing hit, steps from its decay origin to the
// start of this step, and whether the step is a tie ("=", level held without decay). Wraps around.
// chars: x X = 1, o = 0.5, 0-9 = n/9, "=" = tie (hold previous), anything else = rest
const patCache = new Map();
function parsePattern(str) {
  let p = patCache.get(str);
  if (p) return p;
  const s = String(str || "x");
  const L = s.length;
  const lv = (c) => (c === "x" || c === "X" ? 1 : c === "o" || c === "O" ? 0.5 : c >= "0" && c <= "9" ? (c.charCodeAt(0) - 48) / 9 : -1);
  const lvl = new Float64Array(L), back = new Float64Array(L), hold = new Uint8Array(L);
  for (let k = 0; k < L; k++) {
    let level = 0, origin = null, inHold = false;
    // walk back (with wrap) to the governing event
    for (let d = 0; d < L; d++) {
      const j = (((k - d) % L) + L) % L, c = s[j];
      if (c === "=") {
        if (origin === null) { origin = k - d + 1; inHold = d === 0; }
        continue; // keep walking for the level
      }
      const v = lv(c);
      if (v < 0) { if (origin !== null) break; continue; }
      level = v;
      if (origin === null) origin = k - d;
      break;
    }
    if (origin === null) origin = k;
    lvl[k] = level; back[k] = k - origin; hold[k] = inHold ? 1 : 0;
  }
  p = { L, lvl, back, hold };
  patCache.set(str, p);
  return p;
}

export function createEngine(state) {
  let dirty = true, ver = 0;
  let fx = [], N = 0, fIndex = new Map(), objs = [];
  let base = new Float64Array(0), cur = new Float64Array(0);
  let cues = [], tracked = [], changed = [], isSet = [], starts = null, fades = null, ends = null, fxCue = null, camCue = null, perfCue = null, maxSpan = 0;
  let fxLists = [], fxShared = [], fxPrevOnly = [];
  let hits = [], hitT = new Float64Array(0), hitSpan = 0;
  const idxCache = new WeakMap(), valCache = new WeakMap();
  const xs = [], pool = [], rgb = [0, 0, 0];
  const env = { rms: 0, low: 0, mid: 0, high: 0 };
  const frame = {
    t: 0, beat: 0, bar: 1, barBeat: 1, bpm: 120, attrs: {}, dmx: {}, cueId: null, cueIndex: -1, nextCueId: null, env, onset: 0,
    camera: null, cameraCueId: null, cameraTime: 0, performer: null, performerFrom: null, performerTime: 0,
    hitLevel: 0, shake: 0, hits: 0,
  };

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

  const sigCache = new WeakMap();
  const sigOf = (e) => {
    let s = sigCache.get(e);
    if (s === undefined) { const { id, name, ...rest } = e; s = JSON.stringify(rest); sigCache.set(e, s); }
    return s;
  };

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
    tracked = []; changed = []; isSet = []; fxLists = new Array(C).fill(null); fxShared = new Array(C).fill(null); fxPrevOnly = new Array(C).fill(null);
    starts = new Float64Array(C); fades = new Float64Array(C); ends = new Float64Array(C); fxCue = new Int32Array(C); camCue = new Int32Array(C); perfCue = new Int32Array(C);
    maxSpan = 0;
    let prev = base, prevSet = new Uint8Array(N * A), curList = [];
    for (let j = 0; j < C; j++) {
      const c = cues[j];
      const tr = c.block ? Float64Array.from(base) : Float64Array.from(prev);
      const set = c.block ? new Uint8Array(N * A) : Uint8Array.from(prevSet);
      const ex = new Uint8Array(N * A);
      const rm = new Set();
      let killFx = false;
      for (const id of c.kill || []) {
        if (id === "fx") { killFx = true; continue; }
        if (typeof id === "string" && id.startsWith("fx:")) { rm.add(id.slice(3)); continue; }
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
      // effect set: replace (default) or add onto the running set; "fx:<id|name>" kills drop single effects
      const own = Array.isArray(c.effects) ? c.effects : [];
      const fxDef = own.length || c.block || killFx || rm.size;
      if (fxDef) {
        const keep = !c.block && !killFx && (c.fxMode === "add" || (rm.size && !own.length));
        const list = (keep ? curList.filter((e) => !rm.has(e.id) && !(e.name && rm.has(e.name))) : []).concat(own);
        // effects identical to one in the previous set keep running at full weight through the crossfade
        const sp = new Map();
        for (const e of curList) { const s = sigOf(e); (sp.get(s) || sp.set(s, []).get(s)).push(e); }
        const shared = new Uint8Array(list.length), used = new Set();
        list.forEach((e, q) => {
          const p = sp.get(sigOf(e));
          if (p && p.length) { used.add(p.shift()); shared[q] = 1; }
        });
        fxLists[j] = list; fxShared[j] = shared; fxPrevOnly[j] = curList.filter((e) => !used.has(e));
        curList = list;
      }
      fxCue[j] = fxDef ? j : j ? fxCue[j - 1] : -1;
      camCue[j] = c.camera ? j : j ? camCue[j - 1] : -1;
      perfCue[j] = c.performer ? j : j ? perfCue[j - 1] : -1;
      prev = tr; prevSet = set;
    }
    buildHits();
  }

  // show.hits → sorted, pre-resolved table
  function buildHits() {
    hits = []; hitSpan = 0;
    for (const h of state.show.hits || []) {
      if (!h || typeof h.t !== "number" || !Number.isFinite(h.t)) continue;
      const idx = state.resolve(Array.isArray(h.targets) ? h.targets : []).map((id) => fIndex.get(id)).filter((i) => i !== undefined);
      if (!idx.length) continue;
      const at = h.attrs || {};
      const keys = [], vals = [], disc = [];
      let hasRGB = false, hasW = false, hasCol = false;
      for (const key in at) {
        if (key === "dim" || KI[key] === undefined || typeof at[key] !== "number") continue;
        if (COLOR_KEY[key]) { hasCol = true; if (key === "w") hasW = true; else hasRGB = true; }
        keys.push(key); vals.push(at[key]); disc.push(DISCRETE.has(key) || key === "strobe" ? 1 : 0);
      }
      const decay = Math.max(0.005, num(h.decay, HIT_DECAY)), hold = Math.max(0, num(h.hold, 0)), stagger = num(h.stagger, 0);
      const span = hold + HIT_TAIL * decay + Math.abs(stagger) * (idx.length - 1);
      hitSpan = Math.max(hitSpan, span);
      hits.push({
        t: h.t, idx: Int32Array.from(idx), keys, vals, disc, dim: num(at.dim, 1), decay, hold, stagger, span,
        col: h.color === true ? 1 : h.color === false ? 2 : 0, hasCol, killW: hasRGB && !hasW, shake: num(h.shake, 0),
      });
    }
    hits.sort((a, b) => a.t - b.t);
    hitT = Float64Array.from(hits, (h) => h.t);
  }

  // first index with arr[i] >= t / arr[i] > t
  function lowerBound(arr, t) {
    let lo = 0, hi = arr.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < t) lo = m + 1; else hi = m; }
    return lo;
  }
  function upperBound(arr, t) {
    let lo = 0, hi = arr.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] <= t) lo = m + 1; else hi = m; }
    return lo;
  }

  // one-shot hits: dim HTP, colour override weighted by dominance, other attrs LTP by envelope (discrete/strobe while env ≥ .5)
  function applyHits(t) {
    let lvMax = 0, shake = 0, live = 0;
    if (!hits.length) { frame.hitLevel = 0; frame.shake = 0; frame.hits = 0; return; }
    const j1 = upperBound(hitT, t);
    for (let j = lowerBound(hitT, t - hitSpan); j < j1; j++) {
      const h = hits[j];
      if (t - h.t > h.span) continue;
      let any = false;
      for (let i = 0; i < h.idx.length; i++) {
        const dt = t - h.t - (h.stagger >= 0 ? i : i - h.idx.length + 1) * h.stagger;
        if (dt < 0) continue;
        const ex = dt - h.hold;
        const en = ex <= 0 ? 1 : Math.exp(-ex / h.decay);
        if (en < 0.0025) continue;
        any = true;
        const a = objs[h.idx[i]], level = h.dim * en, before = a.dim;
        if (level > before) a.dim = level;
        if (level > lvMax) lvMax = level;
        if (h.shake * en > shake) shake = h.shake * en;
        if (!h.keys.length) continue;
        const wc = h.col === 2 ? 0 : h.col === 1 ? en : en * clamp01(level / Math.max(before, 1e-3));
        let colW = 0;
        for (let q = 0; q < h.keys.length; q++) {
          const key = h.keys[q], v = h.vals[q];
          if (COLOR_KEY[key]) { if (wc > 0) { a[key] += (v - a[key]) * wc; colW = wc; } }
          else if (h.disc[q]) { if (en >= 0.5) a[key] = v; }
          else a[key] += (v - a[key]) * en;
        }
        if (colW > 0) { if (h.killW) a.w -= a.w * colW; pixelsToward(a, colW); }
      }
      if (any) live++;
    }
    frame.hitLevel = lvMax; frame.shake = shake; frame.hits = live;
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
  const bandKey = (b) => (b === "all" || b === "rms" ? "rms" : b === "mid" || b === "high" ? b : "low");

  let onsetPtr = -1;
  function updateAudio(t, beat) {
    const an = state.analysis;
    const e = an && an.env;
    const hop = (e && e.hop) || 0.1;
    env.rms = envAt(e && e.rms, hop, t); env.low = envAt(e && e.low, hop, t);
    env.mid = envAt(e && e.mid, hop, t); env.high = envAt(e && e.high, hop, t);
    const on = an && an.percOnsets;
    if (!on || !on.length) { frame.onset = Math.exp(-frac(beat) * 4); return; }
    t -= onsetShift();
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
  // global onset time shift (s, negative = earlier), show.audio.onsetShift
  const onsetShift = () => num(state.show.audio && state.show.audio.onsetShift, 0);

  // filtered onset tables per (band, threshold, every), rebuilt when the analysis object changes
  let onAn = null, onTables = new Map();
  function onsetTable(band, thr, every) {
    const an = state.analysis;
    if (an !== onAn) { onAn = an; onTables = new Map(); }
    const key = `${band}|${thr}|${every}`;
    let tb = onTables.get(key);
    if (tb) return tb;
    const on = (an && an.percOnsets) || [], e = an && an.env, hop = (e && e.hop) || 0.1;
    const bk = bandKey(band), arr = e && e[bk];
    const ts = [], ss = [];
    let n = 0;
    for (const o of on) {
      const peak = Math.max(envAt(arr, hop, o), envAt(arr, hop, o + 0.05), envAt(arr, hop, o + 0.1));
      if (peak < thr) continue;
      if (n++ % every) continue;
      ts.push(o);
      ss.push(band === "all" ? 1 : clamp01(0.35 + envAt(arr, hop, o) * 0.8));
    }
    tb = { t: Float64Array.from(ts), s: Float64Array.from(ss), none: !on.length };
    onTables.set(key, tb);
    return tb;
  }
  // last qualifying onset for effect e at t → ons.{v (envelope·strength), n (count so far), dt}
  const ons = { v: 0, n: 0, dt: Infinity };
  function onsetFor(e, t, beat, defDecay) {
    const decay = Math.max(0.005, num(e.decay, defDecay)), hold = Math.max(0, num(e.hold, 0));
    const tb = onsetTable(e.band || "low", clamp01(num(e.threshold, 0)), Math.max(1, Math.round(num(e.every, 1))));
    let o, s, n;
    if (tb.none) { // no analysis: every beat is an onset
      const b = Math.floor(beat);
      o = state.timeAtBeat(b); s = 1; n = b + 1;
    } else {
      const ts = tb.t, tt = t - onsetShift();
      const i = upperBound(ts, tt) - 1;
      if (i < 0) { ons.v = 0; ons.n = 0; ons.dt = Infinity; return ons; }
      o = ts[i] + onsetShift(); s = tb.s[i]; n = i + 1;
    }
    const dt = t - o, ex = dt - hold;
    ons.v = (ex <= 0 ? 1 : Math.exp(-ex / decay)) * s; ons.n = n; ons.dt = dt;
    return ons;
  }

  // per-effect constant inputs for the frame (computed once per effect, not per fixture)
  const fe = { t: 0, beat: 0, secPerUnit: 0.5, on: 0, onN: 0 };

  // dim waveform 0..1. ph = per-fixture phase, po = per-fixture phase offset (cycles), ii/m = position in wing
  function dimForm(e, ph, i, baseV, po, ii, m, dir) {
    const duty = e.duty ?? 0.5;
    switch (e.form) {
      case "sine": return 0.5 - 0.5 * Math.cos(TAU * ph);
      // e.end (song time, s): one-shot ramp, holds its final value from then on instead of wrapping
      case "ramp": return e.end !== undefined && fe.t >= e.end ? 1 : ph;
      case "rampDown": return e.end !== undefined && fe.t >= e.end ? 0 : 1 - ph;
      case "square": return ph < duty ? 1 : 0;
      case "pulse": return ph < duty ? 1 - ph / duty : 0;
      case "chase": return ph < duty ? 1 - (ph / duty) ** 2 : 0;
      case "random": return hash(Math.floor(baseV) * 17.13 + i * 3.71) < duty ? 1 : 0;
      case "env": return env[bandKey(e.band)] ?? env.low;
      case "onset": return fe.on;
      case "pattern": {
        const P = parsePattern(e.pattern), div = Math.max(0.0625, num(e.div, 4));
        let pos = (baseV * div + po * P.L) % P.L;
        if (pos < 0) pos += P.L;
        const s = Math.floor(pos);
        if (P.hold[s]) return P.lvl[s];
        const dt = (pos - s + P.back[s]) * fe.secPerUnit / div;
        return P.lvl[s] * Math.exp(-dt / Math.max(0.005, num(e.decay, PATTERN_DECAY)));
      }
      case "onsetStep": {
        if (!fe.onN || !m) return 0;
        const w = Math.max(1, Math.round(num(e.size, 1))), sh = Math.round(((e.offset || 0) / 360) * m);
        let p;
        if (e.order === "random") p = Math.floor(hash(fe.onN * 7.31 + 0.5) * m);
        else p = (((fe.onN - 1 + sh) % m) + m) % m;
        if (dir < 0) p = m - 1 - p;
        for (let k = 0; k < w; k++) if ((p + k * (dir < 0 ? -1 : 1) + m * w) % m === ii) return fe.on;
        return 0;
      }
      default: return 0;
    }
  }

  // apply a list of effects with weight w (0..1) onto objs; shared[q] = 1 → that effect runs at full weight
  function applyEffects(list, w, t, beat, shared) {
    if (!list || !list.length) return;
    for (let q = 0; q < list.length; q++) {
      const e = list[q], we = shared && shared[q] ? 1 : w;
      if (we <= 0 || !e) continue;
      const idx = targetsOf(e), n = idx.length;
      if (!n) continue;
      const free = e.sync === "free", spd = e.speed ?? 1;
      const baseV = (free ? t : beat) * spd;
      const dir = e.dir < 0 ? -1 : 1, spread = (e.phase || 0) / 360, off = (e.offset || 0) / 360;
      if (e.type === "pixel") { pixelEffect(e, idx, we, baseV, dir, spread, off); continue; }
      // per-effect audio inputs
      fe.secPerUnit = (free ? 1 : 60 / (frame.bpm || 120)) / (Math.abs(spd) || 1);
      fe.t = t;
      const f = e.form;
      if (f === "onset" || f === "onsetStep") {
        const o = onsetFor(e, t, beat, f === "onsetStep" ? STEP_DECAY : ONSET_DECAY);
        fe.on = o.v; fe.onN = o.n;
        // legacy: plain onset dim fx without new params uses the global onset
        if (f === "onset" && e.type !== "color" && e.decay === undefined && e.threshold === undefined && e.every === undefined && e.hold === undefined && (e.band === undefined || e.band === "low")) fe.on = frame.onset;
      }
      const W = e.wings | 0, m = W > 1 ? Math.ceil(n / W) : n;
      const attr = e.type === "attr" ? e.attr : null;
      const ak = attr ? KI[attr] : undefined;
      if (e.type === "attr" && ak === undefined) continue;
      for (let i = 0; i < n; i++) {
        let ii = i;
        if (W > 1) { ii = i % m; if (Math.floor(i / m) % 2) ii = m - 1 - ii; }
        const po = (dir * ii / m) * spread + off;
        const ph = frac(baseV + po);
        const a = objs[idx[i]];
        if (e.type === "dim") {
          const v = (e.low ?? 0) + ((e.high ?? 1) - (e.low ?? 0)) * dimForm(e, ph, i, baseV, po, ii, m, dir);
          const nd = e.mode === "abs" ? v : e.mode === "add" ? Math.min(1, a.dim + v) : a.dim * v;
          a.dim += (nd - a.dim) * we;
        } else if (e.type === "attr") {
          const s = ATTRS[attr];
          const v = num(e.low, s.min) + (num(e.high, s.max) - num(e.low, s.min)) * dimForm(e, ph, i, baseV, po, ii, m, dir);
          const cv = a[attr];
          const nv = e.mode === "add" ? cv + v : e.mode === "mul" ? cv * v : v;
          if (DISC[ak]) { if (we >= 0.5) a[attr] = Math.round(nv); }
          else a[attr] = cv + (nv - cv) * we;
          if (COLOR_KEY[attr]) pixelsToward(a, we);
        } else if (e.type === "position") {
          const s = (e.size ?? 30) * we, c = TAU * ph;
          switch (e.form) {
            case "circle": a.pan += s * Math.sin(c); a.tilt += s * Math.cos(c); break;
            case "eight": a.pan += s * Math.sin(c); a.tilt += s * 0.5 * Math.sin(2 * c); break;
            case "pan": a.pan += s * Math.sin(c); break;
            case "tilt": a.tilt += s * Math.sin(c); break;
            case "wave": a.tilt += s * Math.sin(c); a.pan += s * 0.35 * Math.cos(c); break;
            case "fan": a.pan += s * (m > 1 ? (ii / (m - 1)) * 2 - 1 : 0) * (0.5 - 0.5 * Math.cos(TAU * frac(baseV))); break;
            case "random": case "step": {
              const raw = baseV + po, st = Math.floor(raw), fr = raw - st;
              const dut = e.duty ?? 0.5, k = dut > 0 ? sstep(clamp01(fr / dut)) : 1;
              const seed = num(e.seed, 0) * 101.3 + idx[i] * 13.7;
              let p0, t0, p1, t1;
              if (e.form === "random") {
                p0 = hash(seed + (st - 1) * 3.17) * 2 - 1; t0 = hash(seed + (st - 1) * 3.17 + 57.1) * 2 - 1;
                p1 = hash(seed + st * 3.17) * 2 - 1; t1 = hash(seed + st * 3.17 + 57.1) * 2 - 1;
              } else {
                const pts = Array.isArray(e.points) && e.points.length ? e.points : STEP_POINTS, L = pts.length;
                const A0 = pts[(((st - 1) % L) + L) % L] || [0, 0], A1 = pts[((st % L) + L) % L] || [0, 0];
                p0 = A0[0] || 0; t0 = A0[1] || 0; p1 = A1[0] || 0; t1 = A1[1] || 0;
              }
              a.pan += s * (p0 + (p1 - p0) * k); a.tilt += s * (t0 + (t1 - t0) * k);
              break;
            }
          }
        } else if (e.type === "color") {
          const cols = e.colors && e.colors.length ? e.colors : null;
          if (e.form === "rainbow" || !cols) hsvInto(ph, e.sat ?? 1, 1, rgb);
          else if (e.form === "onset" || e.form === "env") {
            let v, c0, c1;
            if (e.form === "onset") {
              v = fe.on; c0 = cols[0];
              c1 = cols.length > 2 ? cols[1 + ((Math.max(1, fe.onN) - 1) % (cols.length - 1))] : cols[1] || [1, 1, 1];
            } else {
              const lo = num(e.low, 0), hi = num(e.high, 1);
              v = clamp01((env[bandKey(e.band)] - lo) / ((hi - lo) || 1));
              const x = v * (cols.length - 1), j = Math.min(cols.length - 2, Math.floor(x));
              if (cols.length < 2) { c0 = c1 = cols[0]; v = 0; } else { c0 = cols[j]; c1 = cols[j + 1]; v = x - j; }
            }
            rgb[0] = c0[0] + (c1[0] - c0[0]) * v; rgb[1] = c0[1] + (c1[1] - c0[1]) * v; rgb[2] = c0[2] + (c1[2] - c0[2]) * v;
          } else { const c = cols[Math.floor(ph * cols.length) % cols.length]; rgb[0] = c[0]; rgb[1] = c[1]; rgb[2] = c[2]; }
          a.r += (rgb[0] - a.r) * we; a.g += (rgb[1] - a.g) * we; a.b += (rgb[2] - a.b) * we; a.w -= a.w * we;
          pixelsToward(a, we);
        }
      }
    }
  }
  const STEP_POINTS = [[-1, -1], [1, -1], [1, 1], [-1, 1]];

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
    frame.cueIndex = k;
    frame.nextCueId = cues[k + 1] ? cues[k + 1].id : null;
    const cc = k >= 0 ? camCue[k] : -1;
    frame.camera = cc >= 0 ? cues[cc].camera : null;
    frame.cameraCueId = cc >= 0 ? cues[cc].id : null;
    frame.cameraTime = cc >= 0 ? cues[cc].time : 0;
    // frontman place (tracked): where he is heading, where he came from, when he set off
    const pc = k >= 0 ? perfCue[k] : -1, pp = pc > 0 ? perfCue[pc - 1] : -1;
    frame.performer = pc >= 0 ? cues[pc].performer : null;
    frame.performerFrom = pp >= 0 ? cues[pp].performer : null;
    frame.performerTime = pc >= 0 ? cues[pc].time + (cues[pc].delay || 0) : 0;
    for (let i = 0; i < N; i++) {
      const a = objs[i], o = i * A;
      for (let q = 0; q < A; q++) a[KEYS[q]] = cur[o + q];
      if (a.pixels) pixelsToward(a, 1);
    }

    // 2. cue effects (crossfade from the previous effect set over the defining cue's fade; shared effects keep running)
    const fc = k >= 0 ? fxCue[k] : -1;
    if (fc >= 0) {
      const p = progress(fc, t);
      if (p < 1) applyEffects(fxPrevOnly[fc], 1 - p, t, beat);
      applyEffects(fxLists[fc], p, t, beat, fxShared[fc]);
    }

    // 2b. one-shot hits
    applyHits(t);

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

  // effects running at time t (after fxMode/kill resolution) – for UI/inspection
  function effectsAt(t) {
    if (dirty) rebuild();
    const k = state.cueIndexAt(t), fc = k >= 0 ? fxCue[k] : -1;
    return fc >= 0 ? fxLists[fc].slice() : [];
  }

  return {
    evaluate, trackedAt, activeCueAt, effectsAt,
    get frame() { return frame; },
    get hitCount() { if (dirty) rebuild(); return hits.length; },
    invalidate() { dirty = true; },
  };
}
