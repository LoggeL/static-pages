// Demo show "Drum Show": hand-programmed cue sheet on the verified song map (true grid 164 BPM, measured attacks).
// Cues carry looks, effect layers and camera shots; drum flashes, crashes and stage FX live in show.hits.
// Cue names are structural only.

import { createShow, applyAnalysis, createState, makeEffect, PRESET_ALIASES } from "../core/state.js";
import { SWATCHES } from "../core/fixtures.js";

/* ------------------------------------------------------------------ song map (structural fields only) */
// grid: t = GRID0 + k·BEAT, k % 4 == 0 is bar 1 (librosa beats/onsets run ~35 ms late; drops use the measured attack)
const GRID0 = 0.018, BEAT = 0.36586;
export const SONG = {
  bpm: 164,
  // [start, marker name, colour]
  sections: [
    [0, "Intro", "#2a3fa8"], [10.262, "Ansage", "#f5e2b8"], [11.726, "Riff-Drop", "#ff2a2a"], [23.433, "Strophe 1", "#a3121e"],
    [35.141, "Vor-Refrain 1", "#9fd4ff"], [40.994, "Refrain 1", "#ff2fb8"], [58.556, "Höhepunkt 1", "#ff8ad8"], [64.409, "Stopp", "#5a0a10"],
    [67.33, "Drum-Feature", "#ffb000"], [76.117, "Strophe 2", "#ff7a1a"], [87.824, "Vor-Refrain 2", "#8fb8e0"], [93.678, "Refrain 2", "#ff2f5e"],
    [111.239, "Höhepunkt 2", "#ffffff"], [117.093, "Bridge", "#3a2a8a"], [140.508, "Explosion", "#fff6d0"], [152.216, "Aufbau", "#c0101a"],
    [153.679, "Finaler Refrain", "#ff3fd0"], [171.24, "Höhepunkt 3", "#ff4040"], [177.094, "Outro-Peak", "#ffcc33"], [194.656, "Finale", "#ff1a1a"],
    [200.326, "Schlussschlag", "#8b95a3"],
  ],
  // [t, type, intensity 0..10]; drop / final hit at the verified attack (194.656, 200.326 instead of the late onsets)
  hits: [
    [10.263, "bass_out", 5], [11.238, "spoken_cue", 6], [11.595, "gap", 3], [11.726, "drop", 9], [20.55, "shout", 6], [22.732, "drum_fill", 6],
    [23.475, "section_change", 5], [34.435, "drum_fill", 6], [34.96, "stop_hit", 7], [35.178, "full_stop", 7], [39.335, "spoken_cue", 7],
    [40.519, "spoken_cue", 7], [40.994, "drop", 9], [46.881, "shout", 6], [54.195, "bass_stutter", 6], [57.121, "bass_stutter", 6],
    [58.607, "section_change", 8], [60.93, "scream", 9], [64.25, "stop_hit", 9], [64.459, "full_stop", 8], [66.804, "shout", 7], [67.15, "gap", 2],
    [67.33, "re_entry", 9], [75.418, "drum_fill", 6], [76.161, "section_change", 6], [82.199, "stop_time", 6], [83.453, "drum_stabs", 7],
    [87.121, "drum_fill", 6], [87.64, "stop_hit", 7], [87.864, "full_stop", 7], [92.021, "spoken_cue", 7], [93.205, "spoken_cue", 7],
    [93.678, "drop", 9], [106.881, "bass_stutter", 6], [109.807, "bass_stutter", 6], [111.27, "section_change", 8], [113.55, "scream", 9],
    [116.936, "stop_hit", 9], [117.098, "full_stop", 8], [120.721, "vocal_entry", 3], [124.92, "gap", 1], [126.6, "vocal_entry", 3],
    [132.43, "vocal_entry", 3], [137.45, "gap", 1], [138.321, "vocal_entry", 4], [140.434, "scream", 10], [140.508, "drop", 10],
    [150.767, "bass_stutter", 6], [152.276, "build", 7], [152.4, "impact", 7], [152.741, "drum_fill", 7], [153.228, "spoken_cue", 7],
    [153.679, "drop", 10], [166.882, "bass_stutter", 6], [171.27, "section_change", 9], [171.828, "shout", 8], [172.338, "shout", 8],
    [173.65, "scream", 10], [177.122, "section_change", 10], [186.8, "shout", 7], [190.288, "bass_stutter", 7], [193.213, "bass_out", 6],
    [193.45, "riser", 8], [194.656, "drop", 10], [199.808, "drum_fill", 8], [200.326, "final_hit", 10], [200.92, "gap", 0],
  ],
  crashes: [
    11.726, 14.65, 17.58, 20.51, 40.99, 43.92, 46.85, 49.77, 52.7, 55.63, 58.56, 61.48, 64.23, 67.34, 68.8, 70.26, 71.73, 73.19, 74.65,
    93.68, 96.61, 99.53, 102.46, 105.39, 108.31, 111.24, 114.17, 116.91, 140.51, 141.97, 143.44, 144.9, 146.36, 147.82, 149.29, 150.75,
    153.68, 156.61, 159.53, 162.46, 165.39, 168.31, 171.24, 174.17, 177.09, 180.02, 182.95, 185.88, 188.8, 190.27, 191.73, 194.66,
    196.12, 197.58, 199.05, 200.33,
  ],
  // [start, end, depth]
  gaps: [
    [11.595, 11.715, "black"], [35.14, 39.3, "dim"], [40.8, 40.97, "dim"], [64.41, 67.15, "dim"], [67.15, 67.31, "black"], [87.82, 92.03, "dim"],
    [117.09, 140.42, "dim"], [124.92, 125.85, "dim"], [137.75, 138.29, "near-black"], [200.92, 204.01, "black"],
  ],
};

// Downbeat phase (0..beatsPerBar-1): segment starts vote strongly, low-band energy on the beat decides the rest.
export function findDownbeat(an, bpb = 4) {
  const b = an.beats || [];
  if (b.length < bpb * 2) return 0;
  const low = an.env?.low || [], hop = an.env?.hop || 0.1;
  const lowAt = (t) => low[Math.max(0, Math.min(low.length - 1, Math.round(t / hop)))] || 0;
  const nearest = (t) => b.reduce((bi, x, i) => (Math.abs(x - t) < Math.abs(b[bi] - t) ? i : bi), 0);
  const on = new Set((an.percOnsets || []).map(nearest));
  const score = new Array(bpb).fill(0), energy = new Array(bpb).fill(0);
  for (const s of (an.segments || []).slice(1)) score[nearest(s) % bpb] += 2;
  b.forEach((t, i) => { energy[i % bpb] += lowAt(t) + (on.has(i) ? 0.25 : 0); });
  const mean = energy.reduce((a, x) => a + x, 0) / bpb || 1;
  energy.forEach((e, p) => { score[p] += e / mean; });
  return score.indexOf(Math.max(...score));
}

/* ------------------------------------------------------------------ colours, rig aliases, grooves */
const COL = Object.fromEntries(SWATCHES.map((s) => [s.name, { r: s.rgbw[0], g: s.rgbw[1], b: s.rgbw[2], w: s.rgbw[3] }]));
const RGB = (n) => [COL[n].r, COL[n].g, COL[n].b];
const W = { r: 1, g: 1, b: 1, w: 1 };
const HIT = "#ffd27a";

// SPOT_C = key light on the frontman (or the drummer in drum moments), SPOT_P = the single cold piano spot in the bridge
const SPOT_P = "f206";
const SPOT_C = ["f204", "f205"], SPOT_OL = ["f201", "f202", "f203"], SPOT_OR = ["f206", "f207", "f208"], SPOT_O = [...SPOT_OL, ...SPOT_OR];
const BEAM_C = ["f304", "f305"], BEAM_OUT = ["f301", "f308"];
const BEAM_PAIR = [null, ["f301", "f308"], ["f302", "f307"], ["f303", "f306"], ["f304", "f305"]];
const BEAM_ODD = ["f301", "f303", "f305", "f307"], BEAM_EVEN = ["f302", "f304", "f306", "f308"];
const BEAM_SCATTER = ["f301", "f308", "f303", "f306", "f302", "f307", "f304", "f305"];
const STROBE_L = ["f601", "f602"], STROBE_R = ["f603", "f604"];
const STROBE_OF = { f301: "f601", f302: "f601", f303: "f602", f304: "f602", f305: "f603", f306: "f603", f307: "f604", f308: "f604" };
const BL_C = ["f702", "f703"], BL_FRONT = ["f701", "f702", "f703", "f704"], BL_TOWER = ["f705", "f706"];
const BL_L = ["f701", "f702", "f705"], BL_R = ["f703", "f704", "f706"];
const LZ_FLOOR = "g-laser-floor", LZ_TOWER = "g-laser-tower", LZ_TRUSS = ["f805", "f806"], LZ_TUN = "f807";
const SPK_FRONT = "g-spark-front", SPK_RISER = "g-spark-riser";
const CO2_IN = ["f1102", "f1103"], CO2_OUT = ["f1101", "f1104"], CO2_L = ["f1101", "f1102"], CO2_R = ["f1103", "f1104"];
const FLM = "g-flame", FLM_OUT = ["f1201", "f1204"];
const PARF = ["g-par", "g-floor"];
// touring band (v4): podium PARs = uplight + LED fascia per player; KEY_B / KEY_G = truss spots borrowed as key light in the riff drop
const BND = "g-band", BND_B = "g-band-bass", BND_G = "g-band-git", BND_S = "g-band-synth", BND_BG = [BND_B, BND_G];
const KEY_B = "f202", KEY_G = "f207", KEYS = [KEY_B, KEY_G];

// 16 steps = 1 bar, step 0 = downbeat
const K_RIFF = "x.x...x...x...x.", K_CHOR = "x...x.....x...x.", K_CLIM = "x...x.x...x.....", K_FEAT = "x.........x...x.";
const K_FIN = "x.x...x.x.....x.", K_BFIN = "..x...x.x.x...x.", SN3 = "........x.......", SN24 = "....x.......x...", Q4 = "x...x...x...x...";
// measured bass-note grid (sub-band flux per 16th): riff / verses = K_RIFF, choruses + outro = K_BCH
const K_BCH = "x...x.x...x.x...";
const CLIM_B = "x...x...........", HEART = "x.......x.......", L1P = "x.......x.......", R1P = "....x.......x...", CHOP8 = "x.x.x.x.x.x.x.x.", HALF = "x.......x.......";

/* ------------------------------------------------------------------ effect macros (plain objects, explicit phase) */
const tg = (...xs) => xs.flat();
const PAT = (t, pattern, decay, low, high = 1, mode = "abs", name = "Groove") =>
  ({ type: "dim", form: "pattern", pattern, div: 4, decay, phase: 0, low, high, mode, targets: tg(t), name });
const ONS = (t, band, threshold, decay, low, high = 1, mode = "abs", name = "Onsets") =>
  ({ type: "dim", form: "onset", band, threshold, decay, low, high, mode, phase: 0, targets: tg(t), name });
const DRUMMER = (low = 0.25, thr = 0.2, decay = 0.15) => ONS("g-riser", "all", thr, decay, low, 1, "abs", "Drummer");
const STEP = (t, name = "Fill-Sprung") =>
  ({ type: "dim", form: "onsetStep", band: "all", threshold: 0.3, decay: 0.12, low: 0, high: 1, mode: "abs", phase: 0, targets: tg(t), name });
const ENVF = (t, band, low, name = "Bass folgt") => ({ type: "dim", form: "env", band, low, high: 1, mode: "mul", phase: 0, targets: tg(t), name });
const SINE = (t, hz, low, name = "Atmen", phase = 360) => ({ type: "dim", form: "sine", sync: "free", speed: hz, low, high: 1, mode: "mul", phase, targets: tg(t), name });
// one-shot ramp t0 → t1 (free running sawtooth phased so it starts at t0; `end` holds the top value from t1 on, a cue still has to kill it)
const RAMPD = (t, t0, t1, low, high, mode, name) => {
  const speed = 1 / (t1 - t0);
  return { type: "dim", form: "ramp", sync: "free", speed, offset: -((t0 * speed) % 1) * 360, end: t1, phase: 0, low, high, mode, targets: tg(t), name };
};
const RAMPA = (t, attr, t0, t1, low, high, name) => ({ ...RAMPD(t, t0, t1, low, high, "abs", name), type: "attr", attr });
const ATTR = (t, attr, form, low, high, o = {}) =>
  ({ type: "attr", attr, form, low, high, mode: "abs", phase: 0, speed: 0.25, targets: tg(t), name: `${attr} ${form}`, ...o });
const CONSET = (t, a, b, thr = 0.5, name = "Kick-Farbe") =>
  ({ type: "color", form: "onset", colors: [RGB(a), RGB(b)], band: "low", threshold: thr, decay: 0.15, phase: 0, targets: tg(t), name });
const CCHASE = (t, names, speed, phase = 360, name = "Farb-Chase") => ({ type: "color", form: "chase", colors: names.map(RGB), speed, phase, targets: tg(t), name });
const POS = (t, form, size, speed, phase = 360, o = {}) => ({ type: "position", form, size, speed, phase, targets: tg(t), name: `Pos ${form}`, ...o });
const PIX = (form, names, speed, size, phase = 360, name = "Pixel") => ({ type: "pixel", form, targets: ["g-bars"], colors: names.map(RGB), speed, size, phase, name });
// beat-locked beam base for the white climax looks: leaves headroom for the snare knives on beats 3 and 4
const KPULS = () => PAT("g-beam", CLIM_B, 0.22, 0.35, 1, "mul", "Klimax-Puls");
const RAINBOW = () => ({ type: "pixel", form: "rainbow", targets: ["g-bars"], speed: 0.25, phase: 720, name: "Regenbogen" });

const CAM_NAME = {
  wide: "Totale", top: "Draufsicht", front: "Front", pit: "Graben", sideL: "Seite links", sideR: "Seite rechts", drums: "Drums",
  singer: "Sänger", piano: "Piano", foh: "FOH", crowd: "Publikum", crowdR: "Publikum rechts", back: "Rückseite", crane: "Kran", auto: "Auto",
  bass: "Bass", guitar: "Gitarre", synth: "Synth",
};

export function createDemoShow(an) {
  const show = applyAnalysis(createShow({ name: "Drum Show – Demo" }), an);
  const st = createState(show);
  st.autosave = false;
  st.analysis = an || null;
  const S = st.show;
  // true grid (pattern step 0 = bar downbeat), onset effects fire on the true attack
  S.audio.beats = Array.from({ length: 558 }, (_, k) => +(GRID0 + k * BEAT).toFixed(4));
  S.audio.bpm = SONG.bpm;
  S.audio.downbeat = 0;
  S.audio.onsetShift = -0.018; // librosa percOnsets run ~19 ms late (median of 680 flux matches)
  // drumless stretches (song map): the viz drummer ignores onsets there (pad / vocals / piano) and rests; stop hits 35.14,
  // 64.23 / 64.41, 87.82, 116.89 stay outside
  S.audio.drumless = [[10.27, 11.72], [35.2, 40.99], [64.45, 67.34], [87.9, 93.68], [117.09, 140.51], [200.4, 210]];
  const T = (bar, beat = 1) => +(GRID0 + ((bar - 1) * 4 + (beat - 1)) * BEAT).toFixed(3);
  const grid = (t) => +(GRID0 + Math.round((t - GRID0) / BEAT) * BEAT).toFixed(3);

  /* ---- value helpers */
  const preset = (name, kind) => S.presets.find((p) => p.name === (PRESET_ALIASES[name] || name) && (!kind || p.kind === kind));
  const pos = (name, ...targets) => {
    const p = preset(name, "position"), out = {};
    for (const id of st.resolve(targets.flat())) { const v = st.presetValues(p, id); if (v) out[id] = { ...v }; }
    return out;
  };
  const beam = (name) => ({ ...preset(name, "beam").attrs });
  const col = (n) => ({ ...COL[n] });
  const L = (...parts) => {
    const out = {};
    for (const p of parts) for (const id in p) out[id] = { ...(out[id] || {}), ...p[id] };
    return out;
  };
  const V = (targets, ...attrs) => Object.fromEntries([targets].flat(2).map((id) => [id, Object.assign({}, ...attrs)]));
  const haze = (v) => V("g-haze", { dim: v });
  // laser look: colour, pattern, fan, beam count, extras {tilt, spd, d}
  const lz = (targets, c, P, fan, n, o = {}) => V(targets, c ? col(c) : {}, {
    ...(P !== undefined && { lzPattern: P }), ...(fan !== undefined && { lzFan: fan }), ...(n !== undefined && { lzBeams: n }),
    ...(o.tilt !== undefined && { lzTilt: o.tilt }), ...(o.spd !== undefined && { lzSpeed: o.spd }), ...(o.d !== undefined && { dim: o.d }),
  });

  /* ---- cue builder: exact times (no beat snap) */
  const cues = [];
  const cue = (time, name, o = {}) => {
    const c = {
      name, time: +(+time).toFixed(3), fade: +(o.fade ?? 0).toFixed(2), delay: 0, color: o.color ?? null, block: !!o.block,
      values: o.values || {}, kill: (o.kill || []).map((k) => (k === "fx" ? k : `fx:${k}`)), note: o.note || "", effects: o.effects || [],
    };
    if (o.add) c.fxMode = "add";
    if (o.camera) c.camera = o.camera;
    if (o.performer) c.performer = o.performer; // frontman: "mic" | "piano"
    cues.push(c);
    return c;
  };
  const cams = [];
  const cam = (time, shot) => cams.push([time, shot]);

  /* ---- hit builder + macros */
  const hits = [];
  const H = (t, targets, attrs, o = {}) => hits.push({
    t: +(+t).toFixed(3), targets: [targets].flat(2), attrs, decay: o.decay ?? 0.25, hold: o.hold ?? 0,
    ...(o.color !== undefined && { color: o.color }), ...(o.stagger && { stagger: o.stagger }), ...(o.shake && { shake: o.shake }), ...(o.name && { name: o.name }),
  });
  const KNIFE = (t, d = 1, str = 0, tow = 0) => {
    H(t, "g-beam", { dim: d, ...W }, { hold: 0.03, decay: 0.16, color: true, name: "Snare" });
    if (str) H(t, "g-strobe", { dim: str }, { decay: 0.07, name: "Snare" });
    if (tow) H(t, BL_TOWER, { dim: tow }, { decay: 0.22, name: "Snare" });
  };
  const KNIFE4 = (t) => H(t, "g-beam", { dim: 0.7, ...W }, { decay: 0.12, color: true, name: "Schlag 4" });
  const PAIR = (t, i, d = 1, decay = 0.14) => H(t, BEAM_PAIR[i], { dim: d, ...W }, { hold: 0.02, decay, color: true, name: "Fill" });
  const C1 = (t) => { H(t, BL_C, { dim: 0.9 }, { hold: 0.03, decay: 0.4, name: "Crash" }); H(t, "g-strobe", { dim: 0.6 }, { decay: 0.08, name: "Crash" }); };
  const C2 = (t, big) => {
    H(t, BL_FRONT, { dim: 0.85 }, { hold: 0.03, decay: 0.45, name: "Crash" });
    H(t, "g-strobe", { dim: 0.8 }, { decay: 0.08, name: "Crash" });
    if (big) H(t, "g-wash", { dim: 1, ...W }, { decay: 0.25, color: true, name: "Crash" });
  };
  const C3 = (t, side) => {
    H(t, side < 0 ? BL_L : BL_R, { dim: 0.9 }, { decay: 0.4, name: "Crash" });
    H(t, side < 0 ? STROBE_L : STROBE_R, { dim: 1 }, { decay: 0.08, name: "Crash" });
  };
  const C4 = (t) => {
    H(t, "g-blinder", { dim: 0.9 }, { hold: 0.04, decay: 0.5, name: "Crash" });
    H(t, "g-strobe", { dim: 1 }, { decay: 0.1, name: "Crash" });
    H(t, "g-wash", { dim: 1, ...W }, { decay: 0.3, color: true, name: "Crash" });
  };
  const C5 = (t) => { C4(t); H(t, [LZ_TOWER, LZ_TRUSS], { dim: 1 }, { hold: 0.05, decay: 0.5, name: "Laser-Schlag" }); };
  const C6 = (t, dec = 0.5) => {
    H(t, "g-blinder", { dim: 1 }, { hold: 0.05, decay: dec, name: "Crash" });
    H(t, "g-strobe", { dim: 1 }, { decay: 0.1, name: "Crash" });
    H(t, "g-par", { dim: 1, ...W }, { decay: 0.25, color: true, name: "Crash" });
  };
  const C7 = (t) => {
    H(t, "g-blinder", { dim: 1 }, { hold: 0.05, decay: 0.4, shake: 0.3, name: "Crash" });
    H(t, "g-strobe", { dim: 1, strobe: 20 }, { hold: 0.15, decay: 0.08, name: "Crash" });
  };
  // blinder wall grows by level: centre pair → front four (40.994) → all six (93.678)
  const BL = (t) => (t < 40.9 ? BL_C : t < 93.6 ? BL_FRONT : "g-blinder");
  const DROP = (t, sh) => {
    H(t, BL(t), { dim: 1 }, { hold: 0.12, decay: 0.7, shake: sh, name: "Drop" });
    H(t, "g-strobe", { dim: 1 }, { hold: 0.04, decay: 0.12, name: "Drop" });
    H(t, ["g-wash", "g-par"], { dim: 1, ...W }, { hold: 0.03, decay: 0.35, color: true, name: "Drop" });
    H(t, ["g-beam", "g-floor"], { dim: 1, ...W }, { decay: 0.25, color: true, name: "Drop" });
    H(t, BND, { dim: 1, ...W }, { hold: 0.03, decay: 0.3, color: true, name: "Drop" }); // the whole band lands the hit
  };
  const STAB = (t, l, sh) => {
    H(t, ["g-wash", "g-spot", "g-beam", "g-floor", "g-par", "g-bars", "g-riser", BND], { dim: l, ...W }, { decay: 0.12, color: true, shake: sh, name: "Stopp-Schlag" });
    H(t, BL(t), { dim: l }, { hold: 0.05, decay: 0.15, name: "Stopp-Schlag" });
    H(t, "g-strobe", { dim: 1 }, { decay: 0.06, name: "Stopp-Schlag" });
  };
  const EXHALE = (t) => {
    H(t, ["g-wash", "g-beam", "g-spot"], { dim: 0.9, ...W }, { decay: 0.6, color: true, name: "Ausatmen" });
    H(t, BL(t), { dim: 0.5 }, { decay: 0.4, name: "Ausatmen" });
  };
  const ACCENT = (t, d) => {
    H(t, SPOT_C, { dim: 1, ...W }, { hold: 0.02, decay: d, color: true, name: "Ruf-Akzent" });
    H(t, BL_C, { dim: 0.55 }, { decay: d, name: "Ruf-Akzent" });
    H(t, "g-par", { dim: 0.7, ...W }, { decay: d, color: true, name: "Ruf-Akzent" });
  };
  // stutter stab L/R; lasers only after their debut (58.556)
  const STUT = (t, side, laser = true, floorLz = false) => {
    const set = side < 0 ? [BEAM_ODD, STROBE_L, laser ? ["f801"] : []] : [BEAM_EVEN, STROBE_R, laser ? ["f802"] : []];
    H(t, set, { dim: 1, ...W }, { hold: 0.02, decay: 0.1, color: true, name: "Stotter" });
    H(t, "g-par", { dim: 1 }, { decay: 0.12, name: "Stotter" });
    if (floorLz) H(t, LZ_FLOOR, { dim: 1 }, { decay: 0.1, name: "Stotter" });
    // the bassist flashes only where the bass comes back in (measured sub band: ≈ -4 dB vs ≤ -20 dB on the cut stabs)
    if (BASS_IN.some((x) => Math.abs(x - t) < 0.02)) BHIT(t, BND_B, 1, 0.1, "Bass-Stotter");
  };
  const BASS_IN = [54.53, 55.444, 57.45, 107.215, 108.12, 110.14, 167.21, 168.13, 190.63, 191.55];
  const BASS_CUT = [150.752, 190.265];
  const FLAME = (t, set = FLM) => H(t, set, { dim: 1 }, { hold: 0.12, decay: 0.1, name: "Flamme" });
  const CO2 = (t, set, dur) => H(t, set, { dim: 1 }, { hold: dur, decay: 0.08, name: "CO2" });
  const SPARK = (t, set, h, dur) => H(t, set, { dim: h }, { hold: dur, decay: 0.3, name: "Funken" });
  // fill note: the kit spots (aimed at the drum riser halves) flash white, left / right alternating
  const KITSPOT = (t, i, set) => H(t, set || (i % 2 ? SPOT_OR : SPOT_OL), { dim: 1, ...W }, { hold: 0.02, decay: 0.14, color: true, name: "Fill-Spot" });
  // band: bass + guitar PARs pump on the measured bass notes (mul on the cue level, so a cue at dim 0 silences them)
  const BRIFF = (pattern = K_RIFF, low = 0.25, name = "Band-Riff", decay = 0.14) => PAT(BND_BG, pattern, decay, low, 1, "mul", name);
  const BHIT = (t, set, d = 1, decay = 0.2, name = "Band") => H(t, set, { dim: d, ...W }, { hold: 0.02, decay, color: true, name });

  // crash tiers from the song map (drops, stop hits and the final hit carry their own macro)
  const OWN = [11.726, 40.99, 64.23, 67.34, 93.68, 116.91, 140.51, 153.68, 194.66, 200.33];
  let c3side = -1;
  for (const raw of SONG.crashes) {
    if (OWN.some((x) => Math.abs(x - raw) < 0.02)) continue;
    const t = grid(raw);
    if (t < 23.433) C1(t);
    else if (t < 64.409) C2(t, Math.abs(t - 58.556) < 0.01);
    else if (t < 76.117) { C3(t, c3side); c3side = -c3side; }
    else if (t < 117.093) C4(t);
    else if (t < 152.216) C5(t);
    else if (t < 194.656) C6(t, Math.abs(t - 191.729) < 0.01 ? 0.35 : 0.5); // last crash before the bass-cut black decays faster
    else C7(t);
    // from the explosion on the whole band rides the crashes: podium fascias + uplights flash white; the bassist stays out
    // where the crash starts a bass cut (150.752, 190.265: sub band ≤ -25 dB)
    if (t > 140.5) BHIT(t, BASS_CUT.some((x) => Math.abs(x - t) < 0.02) ? [BND_G, BND_S] : BND, 1, t < 194.6 ? 0.3 : 0.22, "Crash Band");
  }

  /* ================================================================ S0 Intro "Unter Wasser" (bars 1–7) */
  cue(0, "Intro", {
    block: true, fade: 2, camera: "drums", performer: "mic",
    values: L(haze(0.9), V("g-wash", col("Hellblau"), { dim: 0.6, zoom: 50 }), pos("Bühne Mitte", "g-wash"),
      V(SPOT_C, col("Hellblau"), beam("Offen"), { frost: 0.5, zoom: 12, dim: 0.3 }), pos("Sänger", SPOT_C),
      V("g-beam", col("Hellblau"), beam("Frost"), { dim: 0.6 }), pos("Senkrecht", "g-beam"),
      V("g-bars", col("UV"), { dim: 0.45 }), V("g-riser", col("Blau"), { dim: 0.2 }), V("g-par", col("Blau"), { dim: 0.15 }),
      V(BND_BG, col("Blau"), { dim: 0.18 }), V(BND_S, col("UV"), { dim: 0.22 })),
    effects: [SINE("g-wash", 0.1, 0.6, "Atmen", 120), BRIFF(K_RIFF, 0.35, "Band gedämpft"), PIX("wave", ["UV"], 0.0625, 0.35, 180),
      ONS("g-riser", "all", 0.12, 0.25, 0.12, 0.7, "abs", "Gedämpfter Beat"), { ...POS("g-beam", "tilt", 7, 0.0625, 180), name: "Drift" }],
  });
  cue(2.945, "Intro – Tiefe", { fade: 2.5, values: L(V("g-wash", { dim: 0.75 }), V("g-bars", { dim: 0.5 }), V("g-beam", { dim: 0.7 })) });
  cue(5.872, "Intro – Wasser", {
    fade: 4.3, camera: "sideR", add: true,
    values: L(V(SPOT_O, col("Hellblau"), { gobo: 6, goboSpin: 0.06, frost: 0.25, zoom: 30, dim: 0.6 }), pos("Raster Boden", SPOT_O),
      V(BEAM_C, col("Lavendel"), beam("Offen"), { dim: 0.6 }), pos("Senkrecht", BEAM_C)),
    effects: [{ ...POS(SPOT_O, "wave", 4, 0.0625, 360), name: "Wellen" }],
  });

  cue(8.797, "Intro – Auftauchen", { fade: 1.4, values: L(V(BEAM_C, { dim: 0.75 }), V("g-riser", { dim: 0.28 }), V(SPOT_C, { dim: 0.5 })) });

  /* ================================================================ S1 Ansage (bar 8) */
  cue(10.262, "Ansage", {
    block: true, fade: 0.25, camera: "singer",
    values: L(haze(0.85), V(SPOT_C, col("Warmweiß"), beam("Eng"), { dim: 1 }), pos("Sänger", SPOT_C), V(BL_TOWER, { dim: 0.12 })),
  });
  H(11.2, "g-par", { dim: 0.7, ...W }, { decay: 0.07, color: true, name: "Ruf-Akzent" });
  H(11.2, BL_TOWER, { dim: 0.4 }, { decay: 0.07, name: "Ruf-Akzent" });
  cue(11.595, "Schwarz vor Drop", { block: true, values: haze(0.85), note: "Mikro-Stille vor dem Drop" });

  /* ================================================================ S2 Riff-Drop "Zündung" (bars 9–16) */
  cue(11.726, "Riff-Drop", {
    block: true, camera: "crowdR", color: HIT, note: "gemessener Anschlag",
    values: L(haze(0.85), V("g-beam", col("Rot"), beam("Offen"), { dim: 1 }), pos("Fächer hoch", "g-beam"),
      V("g-floor", col("Rot"), { dim: 1 }), pos("Kreuz", "g-floor"),
      V(SPOT_O, col("Orange"), beam("Gobo Speichen"), { zoom: 14, dim: 0.9 }), pos("Drums links", SPOT_OL), pos("Drums rechts", SPOT_OR),
      V(SPOT_C, col("Warmweiß"), { dim: 0.6 }), pos("Sänger", SPOT_C),
      V("g-wash", col("Tiefrot"), { zoom: 25, dim: 0.6 }), pos("Bühne Mitte", "g-wash"),
      V("g-par", col("Rot"), { dim: 0.12 }), V("g-riser", col("Warmweiß"), { dim: 1 }), V("g-bars", col("Rot"), { dim: 1 }),
      V(BND_BG, col("Orange"), { dim: 1 }), V(BND_S, col("Rot"), { dim: 0.3 }),
      V(KEYS, col("Gelb"), beam("Offen"), { zoom: 11, frost: 0.2, dim: 0.65 }), pos("Bass", KEY_B), pos("Gitarre", KEY_G)),
    effects: [PAT(PARF, K_RIFF, 0.14, 0.12), PAT("g-beam", K_RIFF, 0.12, 0.45, 1, "mul", "Riff"), POS("g-beam", "fan", 18, 0.125, 0), DRUMMER(0.25), ENVF("g-wash", "low", 0.35),
      PIX("chase", ["Orange", "Rot"], 0.5, 0.18, 360), POS(SPOT_O.filter((id) => !KEYS.includes(id)), "tilt", 6, 0.25, 180),
      BRIFF(K_RIFF, 0.15), PAT(KEYS, K_RIFF, 0.16, 0.35, 1, "mul", "Key-Riff")],
  });
  cue(14.652, "Riff – Boden", { fade: 0.3, values: pos("Fächer hoch", "g-floor") });
  cue(17.579, "Riff – B", {
    fade: 0.5, camera: "sideL",
    values: L(pos("Kreuz", "g-beam"), V("g-wash", col("Orange")), V(SPOT_O.filter((id) => !KEYS.includes(id)), beam("Gobo Punkte"))), // keys stay open
  });
  cue(20.506, "Riff – C", { fade: 0.5, camera: "drums", values: L(pos("Fächer hoch", "g-beam"), V("g-wash", col("Rot"))) });
  DROP(11.726, 0.7); CO2(11.726, CO2_IN, 0.7);
  [12.457, 13.921, 15.384, 16.848, 18.311, 19.774, 21.238].forEach((t) => KNIFE(t));
  // fill bar: beams pulled down so the pair walk and the strobes read
  cue(22.701, "Riff – Fill", { values: L(V("g-beam", { dim: 0.25 }), V(KEYS, { dim: 0 }), V(BND_BG, { dim: 0.35 })) });
  // keys stay on bass / guitar: the fill flashes only the four kit spots
  [22.701, 22.885, 23.068, 23.25].forEach((t, i) => {
    PAIR(t, i + 1); H(t, i % 2 ? STROBE_R : STROBE_L, { dim: 0.7 }, { decay: 0.06, name: "Fill" }); KITSPOT(t, i, i % 2 ? ["f206", "f208"] : ["f201", "f203"]);
  });
  cam(14.652, "bass"); cam(16.115, "guitar"); // one bar each on the riff, then back to the stage (17.579 sideL)

  /* ================================================================ S3 Strophe 1 "Glut" (bars 17–24) */
  cue(23.433, "Strophe 1", {
    block: true, camera: "singer",
    values: L(haze(0.8), V("g-wash", col("Rot"), { zoom: 20, dim: 0.6 }), pos("Bühne Mitte", "g-wash"),
      V(SPOT_C, col("Warmweiß"), beam("Offen"), { zoom: 10, dim: 0.7 }), pos("Sänger", SPOT_C),
      V(SPOT_O, col("Orange"), beam("Gobo Punkte"), { zoom: 12, dim: 0.6 }), pos("Drums links", SPOT_OL), pos("Drums rechts", SPOT_OR),
      V("g-beam", col("Rot"), beam("Offen"), { dim: 0.7 }), pos("Fächer hoch", "g-beam"),
      V("g-bars", col("Tiefrot"), { dim: 0.5 }), V("g-par", col("Orange"), { dim: 0.3 }), V("g-riser", col("Orange"), { dim: 1 }),
      V(BND_BG, col("Orange"), { dim: 0.6 }), V(BND_S, col("Tiefrot"), { dim: 0.2 })),
    effects: [DRUMMER(0.25), PAT("g-beam", SN3, 0.25, 0.35, 1, "mul", "Snare-Säulen"), BRIFF(K_RIFF, 0.12),
      { type: "dim", form: "onsetStep", band: "all", threshold: 0.3, decay: 0.3, low: 0, high: 1, mode: "abs", phase: 0, targets: ["g-par"], name: "PAR-Sprung" },
      PIX("wave", ["Tiefrot"], 0.25, 0.3, 360), ENVF("g-wash", "low", 0.6)],
  });
  cue(29.287, "Strophe 1 – B", {
    fade: 2, camera: "front",
    values: L(V(SPOT_O, beam("Gobo Speichen"), { goboSpin: -0.3 }), V("g-beam", { dim: 0.7 }), pos("Kreuz", "g-beam")),
  });
  cue(26.36, "Strophe 1 – Glut 2", { fade: 1, camera: "drums", values: L(V(SPOT_O, { goboSpin: 0.35 }), V("g-bars", { dim: 0.6 })) });
  cue(32.214, "Strophe 1 – Spannung", { fade: 2, camera: "singer", values: L(V("g-wash", { dim: 0.6 }), V("g-beam", { dim: 0.8 }), pos("Fächer hoch", "g-beam")) });
  cue(34.79, "Bass weg", { fade: 0.1, values: V(["g-wash", "g-par", BND], { dim: 0 }) });
  [[34.41, STROBE_L], [34.59, [...STROBE_L, ...STROBE_R]], [34.776, STROBE_R]].forEach(([t, s], i) => {
    PAIR(t, i + 1); H(t, s, { dim: 0.7 }, { decay: 0.06, name: "Fill" }); KITSPOT(t, i, i === 1 ? SPOT_O : null);
  });
  cam(34.41, "drums");
  STAB(34.958, 0.6, 0.4);
  EXHALE(35.141);

  /* ================================================================ S4 Vor-Refrain 1 "Atem anhalten" (bars 25–28) */
  cue(35.141, "Vor-Refrain 1", {
    block: true, camera: "front",
    values: L(haze(0.9), V(BEAM_C, col("Weiß"), beam("Offen"), { dim: 0.45 }), pos("Senkrecht", BEAM_C),
      V(SPOT_C, col("Hellblau"), { frost: 0.4, zoom: 12, dim: 0.45 }), pos("Sänger", SPOT_C), V("g-bars", col("Hellblau"), { dim: 0.25 }),
      V(BND_S, col("Hellblau"), { dim: 0.12 })),
  });
  cue(36.604, "VR1 – Tief", { fade: 1.8, values: L(V(SPOT_C, { dim: 0.33 }), V(BEAM_C, { dim: 0.25 }), V("g-bars", { dim: 0.1 }), V(BND_S, { dim: 0.32 })) });
  H(36.78, "f304", { dim: 1, ...COL.Hellblau }, { decay: 0.5, color: true, name: "Echo" });
  H(37.55, "f305", { dim: 0.85, ...COL.Hellblau }, { decay: 0.5, color: true, name: "Echo" });
  cam(38.068, "synth"); // pad bar on the synth player
  cue(39.335, "Ansage 1", {
    fade: 1.45, camera: "singer", add: true,
    values: L(V("g-beam", col("Weiß"), beam("Offen"), { dim: 0.8 }), pos("Senkrecht", "g-beam"),
      V(SPOT_C, col("Weiß"), { frost: 0, dim: 0.8 }), V("g-strobe", { dim: 0.4 }), V("g-bars", col("Weiß"), { dim: 0.6 }), V(BND_S, col("Hellblau"), { dim: 0.75 })),
    effects: [RAMPA("g-strobe", "strobe", 39.335, 40.811, 2, 14, "Rampe Strobe VR1"), PIX("fill", ["Weiß"], 0.25, 0.3, 0, "Takt-Füller")],
  });
  ACCENT(40.48, 0.06);
  cue(40.811, "Sog – Schwarz", { block: true, values: haze(0.85), note: "Bass-Sog vor dem Refrain" });

  /* ================================================================ S5 Refrain 1 "Neon" (bars 29–40) */
  cue(40.994, "Refrain 1", {
    block: true, camera: "crowd", color: HIT, note: "gemessener Anschlag",
    values: L(haze(0.85), V("g-beam", col("Magenta"), beam("Offen"), { dim: 1 }), pos("Fächer hoch", "g-beam"),
      V("g-floor", col("Cyan"), { dim: 1 }), pos("Fächer hoch", "g-floor"),
      V("g-spot", col("Cyan"), beam("Gobo Splitter"), { zoom: 16, dim: 0.85 }), pos("Fächer Publikum", "g-spot"),
      V("g-wash", col("Magenta"), { zoom: 22, dim: 0.8 }), pos("Bühne Mitte", "g-wash"),
      V("g-par", col("Cyan"), { dim: 0.6 }), V("g-riser", col("Weiß"), { dim: 1 }), V("g-bars", { dim: 1 }),
      V(BND_BG, col("Magenta"), { dim: 0.85 }), V(BND_S, col("Cyan"), { dim: 0.45 })),
    effects: [PAT(PARF, K_CHOR, 0.16, 0.15), POS("g-beam", "fan", 22, 0.125, 0), POS("g-spot", "circle", 10, 0.125, 180),
      CONSET("g-wash", "Magenta", "Weiß", 0.5), DRUMMER(0.3), PIX("chase", ["Cyan", "Magenta"], 1, 0.15, 720), BRIFF(K_BCH, 0.3, "Band-Groove")],
  });
  cue(43.921, "Refrain 1 – Kreuz", { camera: "foh", values: pos("Kreuz", "g-floor") });
  cue(46.848, "Refrain 1 – B", { fade: 0.8, camera: "sideL", values: L(V("g-beam", beam("Prisma 3")), V("g-spot", beam("Gobo Speichen"), { goboSpin: 0.3 })) });
  cue(49.775, "Refrain 1 – C", { camera: "singer", values: L(V("g-floor", col("Magenta")), V("g-par", col("Magenta"))) });
  cue(52.702, "Refrain 1 – Stotter-Takte", {
    camera: "back", add: true,
    values: L(V("g-beam", col("Cyan"), beam("Offen")), pos("Fächer Publikum", "g-beam"), V("g-spot", col("Weiß")), V("g-bars", { dim: 0.3 }), V(BND_G, { dim: 0.35 })),
    effects: [ENVF(["g-beam", "g-wash", BND_B], "low", 0, "Bass-Schnitt")],
  });
  cue(55.629, "Refrain 1 – Stotter 2", { values: V("g-beam", col("Magenta")) });
  cam(54.165, "bass"); cam(57.092, "singer"); // both stutter bars on the bassist (bass-ins 54.53 / 55.444), then the hook
  DROP(40.994, 0.7); CO2(40.994, "g-co2", 0.9);
  [41.726, 43.189, 44.653, 46.116, 47.58, 49.043, 50.507, 51.97, 53.434, 56.36].forEach((t) => KNIFE(t, 1, 0.6));
  [[54.165, -1], [54.53, 1], [54.713, -1], [55.079, 1], [55.265, -1], [55.444, 1], [57.092, -1], [57.45, 1], [57.64, -1], [57.823, 1]]
    .forEach(([t, s]) => STUT(t, s, false));

  /* ================================================================ S6 Höhepunkt 1 "Weißglut I" (bars 41–44) */
  cue(58.556, "Refrain 1 – Höhepunkt", {
    camera: "crowd", add: true, kill: ["Bass-Schnitt", "Groove"], note: "Laser-Debüt",
    values: L(V("g-beam", col("Weiß"), beam("Prisma 3")), pos("Fächer Publikum", "g-beam"), V("g-floor", col("Weiß")), pos("Kreuz", "g-floor"),
      V("g-wash", col("Pink"), { dim: 0.9 }), V("g-spot", col("Pink"), beam("Gobo Splitter")), pos("Publikum", "g-spot"),
      V("g-par", col("Pink"), { dim: 0.7 }), lz(LZ_FLOOR, "Cyan", 1, 50, 12, { tilt: 4, spd: 0, d: 0.7 }),
      V(BND_BG, col("Weiß"), { dim: 1 }), V(BND_S, col("Pink"), { dim: 0.7 })),
    effects: [PAT(PARF, K_CLIM, 0.14, 0.15, 1, "abs", "Groove Höhepunkt"), KPULS(), ATTR(LZ_FLOOR, "lzTilt", "sine", 0, 12, { speed: 0.125 })],
  });
  cue(60.934, "Schrei 1", {
    fade: 0.25, camera: "singer", add: true, kill: ["Pos circle"],
    values: L(V("g-spot", col("Weiß"), beam("Eng"), { dim: 1 }), pos("Sänger", "g-spot"), V("g-strobe", { dim: 0.8 }), V(BND_BG, { dim: 0.55 })),
    effects: [RAMPD("g-blinder", 60.934, 63.5, 0, 0.55, "abs", "Rampe Blinder S1")],
  });
  cue(61.25, "Schrei 1 – Ton", {
    add: true,
    effects: [RAMPA("g-strobe", "strobe", 61.25, 63.5, 4, 16, "Rampe Strobe S1"), RAMPA(LZ_FLOOR, "lzSpeed", 61.25, 63.5, 0, 2, "Rampe Laser S1")],
  });
  cue(63.5, "Schrei 1 – Ende", {
    fade: 0.3, kill: ["Rampe Blinder S1", "Rampe Strobe S1", "Rampe Laser S1"],
    values: L(V("g-strobe", { dim: 0 }), pos("Drums links", SPOT_OL), pos("Drums rechts", SPOT_OR)),
  });
  [59.287, 60.751, 62.214, 63.678].forEach((t) => KNIFE(t, 1, 0.6));
  [59.653, 61.117, 62.58].forEach(KNIFE4);
  cue(64.1, "Vor Stopp-Schlag – Schwarz", { block: true, values: haze(0.9), note: "Schwarz vor dem vorgezogenen Schlag" });
  cue(64.226, "Stopp-Schlag – Schwarz", { block: true, camera: "crowd", values: haze(0.9), note: "Unisono-Schlag aus dem Schwarz" });
  STAB(64.226, 1, 0.8); CO2(64.226, "g-co2", 0.3);
  H(64.226, BL_TOWER, { dim: 0.8 }, { hold: 0.04, decay: 0.12, name: "Stopp-Schlag" });
  H(64.226, LZ_FLOOR, { dim: 1 }, { hold: 0.03, decay: 0.08, name: "Stopp-Schlag" });

  /* ================================================================ S7 Stopp "Glimmen" (bars 45–46) */
  cue(64.409, "Stopp", {
    block: true, camera: "front",
    values: L(haze(0.9), V("g-par", col("Rot"), { dim: 0.5 }), V("g-riser", col("Rot"), { dim: 0.5 }), V("g-wash", col("Rot"), { zoom: 40, dim: 0.3 }), pos("Bühne Mitte", "g-wash"),
      V(SPOT_C, col("Weiß"), beam("Eng"), { dim: 0 }), pos("Sänger", SPOT_C), V(BND_S, col("Rot"), { dim: 0.25 })),
    effects: [SINE("g-par", 0.5, 0.6, "Glut", 180)],
  });
  cue(65.7, "Stopp – Verglühen", { fade: 1, values: L(V("g-par", { dim: 0.25 }), V("g-riser", { dim: 0.25 }), V("g-wash", { dim: 0.15 }), V(BND_S, { dim: 0.1 })) });
  cam(66.787, "singer");
  H(66.787, SPOT_C, { dim: 1, ...W }, { hold: 0.05, decay: 0.07, color: true, name: "Ruf-Akzent" });
  H(66.787, BL(66.787), { dim: 1 }, { hold: 0.05, decay: 0.07, name: "Ruf-Akzent" });
  H(66.787, "g-strobe", { dim: 1 }, { decay: 0.05, name: "Ruf-Akzent" });
  cue(67.153, "Stille – Schwarz", { block: true, values: haze(0.9), note: "totale Stille" });

  /* ================================================================ S8 Drum-Feature "Trommelfeuer" (bars 47–52), gold #1 */
  cue(67.33, "Drum-Feature", {
    block: true, camera: "drums", color: HIT, note: "Wiedereinstieg, gemessener Anschlag",
    values: L(haze(0.9), V("g-beam", col("Gelb"), beam("Offen"), { dim: 0.55 }), pos("Fächer Publikum", "g-beam"),
      V("g-floor", col("Orange"), { dim: 1 }), pos("Senkrecht", "g-floor"),
      // the key pair is the one hard white light on the drummer; outer spots soft gold, riser low (Ping/Pong + Drummer punch)
      V(SPOT_O, col("Gelb"), beam("Offen"), { zoom: 22, dim: 0.55 }), pos("Drums links", SPOT_OL), pos("Drums rechts", SPOT_OR),
      V(SPOT_C, col("Weiß"), beam("Eng"), { zoom: 12, dim: 0.8 }), pos("Drums", SPOT_C),
      V("g-wash", col("Orange"), { zoom: 30, dim: 0.7 }), pos("Bühne Mitte", "g-wash"),
      V("g-par", col("Gelb"), { dim: 0.5 }), V("g-riser", col("Warmweiß"), { dim: 0.6 }), V("g-bars", col("Orange"), { dim: 1 }),
      lz(LZ_FLOOR, "Gelb", 1, 40, 8, { tilt: 6, d: 1 }), V(BND_BG, col("Gelb"), { dim: 0.6 }), V(BND_S, col("Orange"), { dim: 0.3 })),
    effects: [{ ...PAT("g-strobe", "x...............", 0.06, 0, 1, "abs", "Strobe-Lauf"), phase: 360 }, BRIFF(K_FEAT, 0.2, "Band-Groove"),
      PAT(PARF, K_FEAT, 0.14, 0.15), PAT(["g-drum-l", ...SPOT_OL], L1P, 0.25, 0.2, 1, "mul", "Ping"),
      PAT(["g-drum-r", ...SPOT_OR], R1P, 0.25, 0.2, 1, "mul", "Pong"), POS("g-beam", "random", 22, 0.25, 0, { duty: 0 }),
      CONSET("g-par", "Gelb", "Weiß", 0.45), PAT(LZ_FLOOR, Q4, 0.2, 0, 1, "abs", "Laser-Puls"), PIX("sparkle", ["Weiß", "Orange"], 1, 0.5, 360)],
  });
  cue(68.8, "Drum-Feature – Gold", { values: V("g-floor", col("Gelb")) });
  cue(70.263, "Drum-Feature – Prisma", { camera: "back", values: V("g-beam", beam("Prisma 3")) });
  cue(71.727, "Drum-Feature – B", {
    values: L(V("g-beam", col("Weiß")), pos("Fächer hoch", "g-beam"), V(SPOT_O, col("Orange")), V("g-floor", col("Rot"))), // spots stay on the kit
  });
  cue(73.19, "Drum-Feature – C", { camera: "sideR", values: L(V("g-beam", beam("Offen")), V("g-wash", col("Gelb"))) });
  cue(74.653, "Drum-Feature – D", { values: L(V("g-beam", col("Gelb")), V("g-floor", col("Orange"))) });
  DROP(67.33, 0.8); CO2(67.33, "g-co2", 0.8);
  for (let b = 0; b < 22; b++) PAIR(T(47 + Math.floor(b / 4), (b % 4) + 1), (b % 4) + 1); // every-beat walk out → in
  [75.385, 75.57, 75.751, 75.94].forEach((t, i) => { PAIR(t, i + 1); KITSPOT(t, i); });
  cam(75.385, "drums");

  /* ================================================================ S9 Strophe 2 "Stakkato" (bars 53–60) */
  const V2 = [PAT("g-beam", K_RIFF, 0.12, 0.35, 1, "mul", "Riff"), POS("g-beam", "step", 15, 0.5, 0, { duty: 0 }), POS(SPOT_O, "random", 12, 0.5, 360),
    DRUMMER(0.25), PIX("chase", ["Orange", "Blau"], 0.5, 0.2, 360), ENVF("g-wash", "low", 0.6), BRIFF(K_RIFF, 0.12)];
  cue(76.117, "Strophe 2", {
    block: true, camera: "front",
    values: L(haze(0.85), V("g-wash", col("Blau"), { zoom: 25, dim: 0.6 }), pos("Bühne Mitte", "g-wash"),
      V(SPOT_C, col("Warmweiß"), { zoom: 10, dim: 0.75 }), pos("Sänger", SPOT_C),
      V(SPOT_O, col("Orange"), beam("Gobo Punkte"), { zoom: 14, dim: 0.5 }), pos("Raster Boden", SPOT_O),
      V("g-beam", col("Orange"), beam("Offen"), { dim: 0.75 }), pos("Kreuz", "g-beam"),
      V("g-bars", col("Blau"), { dim: 0.6 }), V("g-par", col("Orange"), { dim: 0.3 }), V("g-riser", col("Orange"), { dim: 1 }),
      V(BND_BG, col("Orange"), { dim: 0.65 }), V(BND_S, col("Blau"), { dim: 0.25 })),
    effects: V2,
  });
  cue(79.044, "Strophe 2 – Speichen", { camera: "singer", fade: 0.3, values: V(SPOT_O, beam("Gobo Speichen")) });
  cue(81.239, "Strophe 2 – Gelb", { fade: 0.3, values: V(SPOT_O, col("Gelb")) });
  cue(82.154, "Stop-Time", {
    camera: "drums", note: "Mitten weg, Einzel-Stabs",
    values: L(V("g-beam", col("Weiß"), { dim: 0 }), V(SPOT_O, { dim: 0 }), V("g-wash", { dim: 0.15 }), V("g-bars", { dim: 0 }), V(BND, { dim: 0 })),
    effects: [DRUMMER(0.1), { ...POS("g-beam", "random", 35, 2, 0, { duty: 0 }), name: "Foto" }],
  });
  [82.51, 82.7, 83.07, 83.25, 83.43, 83.62, 83.79, 83.98, 84.16, 84.35, 84.72].forEach((t, i) => {
    const b = BEAM_SCATTER[i % BEAM_SCATTER.length];
    H(t, b, { dim: 1, ...W }, { hold: 0.03, decay: 0.12, color: true, name: "Stab" });
    H(t, STROBE_OF[b], { dim: 0.8 }, { decay: 0.05, name: "Stab" });
    if (Math.abs(t - 83.43) < 0.01 || Math.abs(t - 83.79) < 0.01) H(t, BL_FRONT, { dim: 0.6 }, { decay: 0.2, name: "Stab" });
  });
  cue(84.898, "Strophe 2 – B", {
    fade: 0.3, camera: "sideL",
    values: L(V("g-beam", col("Blau"), { dim: 0.75 }), V("g-wash", col("Orange"), { dim: 0.6 }), V("g-bars", col("Orange"), { dim: 0.6 }), V(SPOT_O, { dim: 0.5 }),
      V(BND_BG, { dim: 0.65 }), V(BND_S, { dim: 0.25 })),
    effects: V2,
  });
  H(84.898, BL_C, { dim: 0.6 }, { decay: 0.3, name: "Sub-Stab" });
  [76.849, 78.312, 79.775, 81.239, 85.629].forEach((t) => KNIFE(t, 0.7));
  // fill: outer spots jump onto the kit in the dark, then flash on the fill notes
  cue(87.093, "Strophe 2 – Fill", {
    camera: "drums", kill: ["Pos random"],
    values: L(V(SPOT_O, col("Weiß"), beam("Offen"), { zoom: 10, dim: 0 }), pos("Drums links", SPOT_OL), pos("Drums rechts", SPOT_OR), V(BND_BG, { dim: 0.3 })),
  });
  [87.093, 87.27, 87.46].forEach((t, i) => { PAIR(t, i + 1); KITSPOT(t, i); });
  STAB(87.641, 0.6, 0.4);
  EXHALE(87.824);

  /* ================================================================ S10 Vor-Refrain 2 "Lunte" (bars 61–64) */
  cue(87.824, "Vor-Refrain 2", {
    block: true, camera: "front",
    values: L(haze(0.9), V(BEAM_OUT, col("Hellblau"), beam("Offen"), { dim: 0.4 }), pos("Senkrecht", BEAM_OUT),
      V(SPOT_C, col("Weiß"), { frost: 0.3, zoom: 12, dim: 0.45 }), pos("Sänger", SPOT_C), V("g-bars", col("Hellblau"), { dim: 0.2 }),
      V(BND_S, col("Hellblau"), { dim: 0.12 })),
  });
  cue(89.288, "VR2 – Tief", { fade: 1.8, values: L(V(SPOT_C, { dim: 0.4 }), V(BEAM_OUT, { dim: 0.3 }), V("g-bars", { dim: 0.1 }), V(BND_S, { dim: 0.32 })) });
  H(89.45, BEAM_OUT, { dim: 1, ...COL.Hellblau }, { decay: 0.6, color: true, name: "Echo" });
  H(90.25, ["f302", "f307"], { dim: 0.85, ...COL.Hellblau }, { decay: 0.6, color: true, name: "Echo" });
  cam(90.751, "synth");
  cue(92.021, "Ansage 2", {
    fade: 1.2, camera: "singer", add: true, note: "Laser-Lunte",
    values: L(V("g-beam", col("Weiß"), beam("Offen"), { dim: 0.9 }), pos("Senkrecht", "g-beam"), V(SPOT_C, { dim: 0.9, frost: 0 }),
      V("g-strobe", { dim: 0.5 }), lz(LZ_FLOOR, "Weiß", 0, undefined, 1, { tilt: -10, d: 0.6 }), V(BND_S, col("Hellblau"), { dim: 0.75 })),
    effects: [RAMPA("g-strobe", "strobe", 92.021, 93.495, 4, 18, "Rampe Strobe VR2"), RAMPA(LZ_FLOOR, "lzTilt", 92.021, 93.495, -10, 12, "Rampe Lunte")],
  });
  cue(92.21, "Ansage 2 – Bass weg", { add: true, effects: [RAMPD("g-blinder", 92.21, 93.495, 0, 0.7, "abs", "Rampe Blinder VR2")] });
  ACCENT(93.18, 0.05);
  cue(93.495, "Sog 2 – Schwarz", { block: true, values: haze(0.9) });

  /* ================================================================ S11 Refrain 2 "Neon heiß" (bars 65–76) */
  cue(93.678, "Refrain 2", {
    block: true, camera: "crowd", color: HIT, note: "gemessener Anschlag",
    values: L(haze(0.9), V("g-beam", col("Rot"), beam("Offen"), { dim: 1 }), pos("Fächer hoch", "g-beam"),
      V("g-floor", col("Magenta"), { dim: 1 }), pos("Fächer hoch", "g-floor"),
      V("g-spot", col("Weiß"), beam("Gobo Splitter"), { zoom: 16, dim: 0.9 }), pos("Fächer Publikum", "g-spot"),
      V("g-wash", col("Rot"), { zoom: 22, dim: 0.85 }), pos("Bühne Mitte", "g-wash"),
      V("g-par", col("Magenta"), { dim: 0.6 }), V("g-riser", col("Weiß"), { dim: 1 }), V("g-bars", { dim: 1 }),
      lz(LZ_FLOOR, "Cyan", 2, 70, 16, { tilt: -3, d: 0.9 }), lz(LZ_TOWER, "Cyan", 1, 60, 12, { spd: 0.5, d: 1 }),
      V(BND_BG, col("Rot"), { dim: 0.95 }), V(BND_S, col("Magenta"), { dim: 0.5 })),
    effects: [PAT(PARF, K_CHOR, 0.16, 0.15), POS("g-beam", "fan", 26, 0.25, 0), POS("g-spot", "eight", 12, 0.25, 180), BRIFF(K_BCH, 0.3, "Band-Groove"),
      CONSET("g-wash", "Rot", "Weiß", 0.5), CCHASE("g-par", ["Magenta", "Pink"], 0.25), DRUMMER(0.3), PIX("chase", ["Weiß", "Rot"], 1, 0.12, 720),
      ATTR([LZ_FLOOR, LZ_TOWER], "lzTilt", "sine", -8, 10, { speed: 0.25, phase: 180 }),
      ATTR(LZ_TOWER, "lzFan", "onset", 40, 85, { band: "low", threshold: 0.3, decay: 0.2 }),
      ATTR("g-wash", "zoom", "onset", 22, 10, { band: "low", threshold: 0.3, decay: 0.15 })],
  });
  cue(96.605, "Refrain 2 – Kreuz", { camera: "pit", values: pos("Kreuz", "g-floor") });
  cue(99.532, "Refrain 2 – B", {
    fade: 0.8, camera: "sideR", note: "Laser-Scan",
    values: L(V("g-beam", col("Magenta"), beam("Prisma linear")), V("g-spot", col("Rot"), beam("Gobo Speichen")), V("g-wash", col("Magenta")),
      lz(LZ_TRUSS, "Weiß", 4, 60, 12, { spd: 1, d: 0.8 })),
  });
  cue(102.459, "Refrain 2 – C", { camera: "crane", values: L(V("g-floor", col("Rot")), V("g-spot", col("Magenta"))) });
  cue(105.386, "Refrain 2 – Stotter-Takte", {
    camera: "back", add: true, kill: ["Pixel"], note: "Regenbogen-Pixel",
    values: L(V("g-beam", col("Weiß"), beam("Offen")), pos("Fächer Publikum", "g-beam"), lz([LZ_FLOOR, LZ_TOWER], null, 1, 90, 24),
      V(LZ_TRUSS, { dim: 0 }), V("g-bars", { dim: 1 }), V(BND_G, { dim: 0.35 })),
    effects: [ENVF(["g-beam", "g-wash", LZ_FLOOR, LZ_TOWER, BND_B], "low", 0, "Bass-Schnitt"), RAINBOW()],
  });
  cue(108.313, "Refrain 2 – Stotter 2", { camera: "drums", values: V("g-beam", col("Rot")) });
  cam(106.849, "bass"); // first stutter bar on the bassist
  DROP(93.678, 0.7); CO2(93.678, "g-co2", 1.0);
  [94.41, 95.873, 97.337, 98.8, 100.264, 101.727, 103.191, 104.654, 106.117, 109.044].forEach((t) => KNIFE(t, 1, 1));
  [[106.849, -1], [107.215, 1], [107.4, -1], [107.76, 1], [107.947, -1], [108.12, 1]].forEach(([t, s]) => STUT(t, s, true, true));
  [[109.776, -1], [110.14, 1]].forEach(([t, s]) => STUT(t, s));

  /* ================================================================ S12 Höhepunkt 2 "Weißglut II" (bars 77–80) */
  cue(111.239, "Refrain 2 – Höhepunkt", {
    camera: "foh", add: true, kill: ["Bass-Schnitt", "Groove"],
    values: L(V("g-beam", col("Weiß"), beam("Prisma 3")), pos("Fächer Publikum", "g-beam"), V("g-wash", col("Rot"), { dim: 1 }),
      V("g-spot", col("Weiß"), beam("Gobo Splitter")), pos("Publikum", "g-spot"), V("g-floor", col("Weiß")), pos("Kreuz", "g-floor"),
      lz([LZ_FLOOR, LZ_TOWER], "Cyan", 1, 80, 24, { spd: 0.8, d: 1 }), lz(LZ_TRUSS, "Cyan", 4, undefined, undefined, { d: 1 }),
      V(BND_BG, col("Weiß"), { dim: 1 }), V(BND_S, col("Rot"), { dim: 0.7 })),
    effects: [PAT(PARF, K_CLIM, 0.14, 0.15, 1, "abs", "Groove Höhepunkt"), KPULS()],
  });
  cue(113.3, "Atem", {
    kill: ["Groove Höhepunkt", "Drummer", "Klimax-Puls", "Pos eight"], note: "Atempause vor dem Schrei",
    values: L(V(["g-beam", "g-floor", "g-wash", ...SPOT_O, "g-par", "g-bars", "g-riser", BND], { dim: 0.1 }), V(SPOT_C, col("Weiß"), beam("Eng"), { dim: 0.9 }), pos("Sänger", SPOT_C),
      V("g-laser", { dim: 0 })),
  });
  cue(113.526, "Schrei 2", {
    camera: "singer", add: true, kill: ["Regenbogen", "Pos eight"], note: "Magenta/Cyan-Glut, Weiß bleibt der Explosion",
    values: L(V(["g-spot", "g-bars"], col("Weiß"), { dim: 1 }), V(["g-beam", "g-wash", "g-par"], col("Magenta"), { dim: 1 }), V("g-floor", col("Cyan"), { dim: 1 }),
      V("g-spot", beam("Eng")), pos("Sänger", "g-spot"),
      lz([LZ_FLOOR, LZ_TOWER], "Cyan", 1, 90, 32, { d: 1 }), V(LZ_TRUSS, { dim: 0 }), lz(LZ_TUN, "Weiß", 3, 30, 32, { d: 1 }), V("g-strobe", { dim: 0.75 }),
      V(BND_BG, col("Magenta"), { dim: 0.75 }), V(BND_S, col("Cyan"), { dim: 0.6 })),
    effects: [PAT(PARF, K_CLIM, 0.14, 0.15, 1, "abs", "Groove Höhepunkt"), KPULS(), DRUMMER(0.3)],
  });
  cue(113.85, "Schrei 2 – Ton", {
    add: true,
    effects: [RAMPA("g-strobe", "strobe", 113.85, 116.8, 6, 20, "Rampe Strobe S2"), RAMPA("g-laser", "lzFan", 113.85, 116.8, 90, 10, "Rampe Laser zu"),
      RAMPA("g-laser", "lzSpeed", 113.85, 116.8, 0.5, 4, "Rampe Laser dreh"), RAMPD("g-blinder", 113.85, 116.8, 0, 0.4, "abs", "Rampe Blinder S2")],
  });
  cue(113.851, "Schrei 2 – Konvergenz", { fade: 3, kill: ["Pos fan"], values: pos("Publikum", "g-beam", "g-floor"), note: "alle Beams auf einen Punkt" });
  cam(115.63, "front");
  [111.971, 114.898, 116.361].forEach((t) => KNIFE(t, 1, 1));
  // beat 4 before the anticipated hit: short knife that is out by the black at 116.80
  H(116.727, "g-beam", { dim: 1, ...W }, { decay: 0.04, color: true, name: "Snare" });
  H(116.727, "g-strobe", { dim: 1 }, { decay: 0.04, name: "Snare" });
  [112.337, 113.8, 115.264].forEach(KNIFE4);
  cue(116.8, "Vor Stopp-Schlag – Schwarz", { block: true, values: haze(1), note: "Schwarz vor dem vorgezogenen Schlag" });
  cue(116.91, "Stopp-Schlag – Schwarz", { block: true, values: haze(1), note: "Unisono-Schlag aus dem Schwarz, Höhen enden 116.95" });
  STAB(116.91, 1, 0.8); CO2(116.91, "g-co2", 0.35);
  H(116.91, "g-laser", { dim: 1 }, { hold: 0.03, decay: 0.08, name: "Stopp-Schlag" });

  /* ================================================================ S13 Bridge "Tiefsee / Uhrwerk" (bars 81–96) */
  cue(117.093, "Bridge – Leere", {
    block: true, camera: "sideR", performer: "piano", note: "Sänger geht ans Piano",
    values: L(haze(1), V("g-bars", col("Hellblau"), { dim: 0.35 }), V("g-riser", col("Hellblau"), { dim: 0.35 }),
      V("g-wash", col("Hellblau"), { zoom: 50, dim: 0.4 }), pos("Bühne Mitte", "g-wash"), V(BND_S, col("Lavendel"), { dim: 0.09 })),
    effects: [PIX("chase", ["Hellblau"], 0.125, 0.03, 0, "Uhrwerk"), PAT("g-riser", HEART, 0.45, 0.05, 0.4, "abs", "Herzschlag"), SINE(BND_S, 0.06, 0.45, "Pad atmet", 90)],
  });
  cue(120.721, "Bridge – Phrase 1", {
    fade: 3, camera: "piano",
    values: L(V("g-wash", col("Lavendel"), { dim: 0.5 }), V(SPOT_P, col("Hellblau"), beam("Offen"), { frost: 0.2, zoom: 14, dim: 0.9 }), pos("Piano", SPOT_P)),
  });
  cue(124.92, "Bridge – Pause", { fade: 0.4, values: L(V(SPOT_P, { dim: 0.4 }), V("g-wash", { dim: 0.3 })) });
  cue(126.6, "Bridge – Phrase 2", {
    fade: 4, camera: "sideL", add: true,
    values: L(V(SPOT_P, { dim: 0.9 }), V(BEAM_OUT, col("Hellblau"), beam("Offen"), { dim: 0.55 }), pos("Senkrecht", BEAM_OUT),
      V("g-wash", col("Lavendel"), { zoom: 50, dim: 0.55 }), pos("Bühne Mitte", "g-wash")),
    effects: [{ ...POS(BEAM_OUT, "tilt", 8, 0.03, 180), name: "Regen" }],
  });
  cue(132.43, "Bridge – Phrase 3", {
    fade: 5, camera: "pit", add: true, note: "Laser-Decke",
    values: L(V("g-beam", col("Hellblau"), beam("Offen"), { dim: 0.6 }), pos("Fächer hoch", "g-beam"),
      lz(LZ_FLOOR, "Cyan", 2, 90, undefined, { tilt: -2, spd: 0, d: 0.8 }), V("g-bars", col("Lavendel")), V(BND_S, { dim: 0.14 })),
    effects: [{ ...POS("g-beam", "fan", 10, 0.0625, 0), name: "Kathedrale" }, SINE("g-beam", 0.08, 0.6, "Kathedrale atmet"),
      ATTR(LZ_FLOOR, "lzTilt", "sine", -4, 2, { sync: "free", speed: 0.03 })],
  });
  cue(135.3, "Bridge – Rückweg", {
    fade: 2, performer: "mic", note: "Phrase 3 endet: Sänger geht zurück ans Mikro (an bei ~137.8)",
    values: V(SPOT_P, { dim: 0.45 }),
  });
  cue(137.45, "Bridge – Verlöschen", {
    fade: 0.3, camera: "wide", note: "Key-Licht fährt im Dunkeln auf den Sänger",
    kill: ["Kathedrale", "Kathedrale atmet", "Regen", "Herzschlag", "Uhrwerk", "Pad atmet"],
    values: L(V(["g-bars", "g-beam", "g-wash", "g-laser", "g-spot", BND], { dim: 0 }), V(SPOT_P, { dim: 0.05 }), V("g-riser", col("Blau"), { dim: 0.05 }),
      V(SPOT_C, col("Weiß"), beam("Eng"), { frost: 0, zoom: 30, dim: 0 }), pos("Sänger", SPOT_C)),
  });
  cue(138.321, "Bridge – Letzte Phrase", {
    fade: 2, camera: "singer", add: true,
    values: L(V(SPOT_C, col("Weiß"), beam("Eng"), { frost: 0, zoom: 30, dim: 0.9 }), pos("Sänger", SPOT_C),
      V([...BEAM_C, "f303", "f306"], col("Weiß"), beam("Offen"), { dim: 0.6 }), pos("Senkrecht", BEAM_C, "f303", "f306")),
    effects: [RAMPA(SPOT_C, "zoom", 138.321, 140.325, 30, 8, "Atem anhalten")],
  });
  cue(140.325, "Luft anhalten – Schwarz", {
    block: true, note: "183 ms Stille vor der Explosion",
    values: L(haze(1), V("g-beam", col("Weiß"), { dim: 0 }), pos("Fächer hoch", "g-beam"), V("g-spot", col("Weiß"), { dim: 0 }),
      pos("Publikum", SPOT_O), pos("Drums", SPOT_C)),
  });

  /* ================================================================ S14 Explosion "Supernova" (bars 97–104) */
  cue(140.508, "EXPLOSION", {
    block: true, camera: "foh", color: HIT, note: "größter Einschlag: einziger Vollweiß-Schlag, Flammen-Debüt, Laser-Tunnel",
    values: L(haze(1), V("g-beam", col("Weiß"), beam("Offen"), { dim: 1 }), pos("Fächer hoch", "g-beam"),
      V("g-floor", col("Weiß"), { dim: 1 }), pos("Fächer hoch", "g-floor"),
      V("g-spot", col("Weiß"), beam("Offen"), { zoom: 40, dim: 1 }), pos("Publikum", SPOT_O), pos("Drums", SPOT_C),
      V("g-wash", col("Rot"), { zoom: 50, dim: 1 }), pos("Publikum", "g-wash"),
      V("g-par", col("Rot"), { dim: 1 }), V("g-bars", col("Rot"), { dim: 1 }), V("g-riser", col("Weiß"), { dim: 1 }),
      lz([LZ_FLOOR, LZ_TUN], "Weiß", 3, 30, 32, { spd: 2, d: 1 }), lz([LZ_TOWER, LZ_TRUSS], "Rot", 2, 80, 20, { d: 0.35 }),
      V(BND_BG, col("Rot"), { dim: 0.9 }), V(BND_S, col("Weiß"), { dim: 0.55 })),
    effects: [POS("g-beam", "step", 24, 0.5, 0, { duty: 0 }), BRIFF("x...x.........x.", 0.3, "Band-Groove"), PAT("g-beam", HALF, 0.3, 0.6, 1, "mul", "Crash+Snare"),
      PAT("g-strobe", HALF, 0.08, 0, 1, "abs", "Snare-Strobe"), PAT(BL_TOWER, HALF, 0.25, 0, 0.8, "abs", "Turm-Puls"), PAT(PARF, K_CHOR, 0.16, 0.2), POS(SPOT_O, "random", 15, 0.5, 360), DRUMMER(0.3),
      ATTR("g-spot", "zoom", "pattern", 40, 10, { pattern: HALF, div: 4, decay: 0.3, speed: 1 }),
      ATTR([LZ_FLOOR, LZ_TUN], "lzFan", "onset", 25, 55, { band: "low", threshold: 0.3, decay: 0.2 }), PIX("chase", ["Weiß", "Gelb"], 2, 0.1, 720)],
  });
  cue(141.972, "Explosion – Gold", {
    camera: "crowd", add: true,
    values: L(V("g-beam", col("Gelb")), V("g-floor", col("Rot")), V("g-wash", col("Rot")), V("g-par", col("Orange")), V("g-spot", col("Warmweiß")),
      V("g-bars", col("Gelb")), V([LZ_FLOOR, LZ_TUN], col("Gelb")), V(BND_BG, col("Orange"))),
    effects: [CONSET("g-wash", "Rot", "Weiß", 0.45)],
  });
  cue(143.435, "Explosion – Schlagzeug", { camera: "drums", values: V("g-floor", col("Gelb")) }); // drum feature: the drummer on camera early
  cue(144.899, "Explosion – Orange", { values: V("g-beam", col("Orange")) });
  cue(146.362, "Explosion – Prisma", {
    camera: "crowdR",
    values: L(V("g-beam", col("Weiß"), beam("Prisma 3")), V(SPOT_O, beam("Gobo Splitter"), { zoom: 14 }), pos("Fächer Publikum", SPOT_O),
      lz(LZ_TRUSS, "Rot", 4, undefined, undefined, { d: 0.35 })),
  });
  cue(147.825, "Explosion – Speichen", { values: V(SPOT_O, beam("Gobo Speichen")) });
  cue(149.289, "Explosion – Rot", { camera: "drums", values: V("g-beam", col("Rot")) });
  cue(150.752, "Explosion – Stotter", {
    camera: "sideL", add: true, values: L(V("g-wash", { dim: 0.3 }), V("g-laser", { dim: 0 }), V(BND_G, { dim: 0.35 })),
    effects: [ENVF(["g-wash", "g-par", BND_B], "low", 0, "Bass-Schnitt")],
  });
  H(140.508, "g-blinder", { dim: 1 }, { hold: 0.15, decay: 0.8, shake: 1, name: "Explosion" });
  H(140.508, "g-strobe", { dim: 1 }, { hold: 0.12, decay: 0.25, name: "Explosion" });
  H(140.508, ["g-wash", "g-par", "g-bars", "g-floor", "g-spot", "g-beam", BND], { dim: 1, ...W }, { hold: 0.06, decay: 0.12, color: true, name: "Explosion" });
  H(140.508, [LZ_TOWER, LZ_TRUSS], { dim: 1 }, { hold: 0.3, decay: 0.8, name: "Explosion" }); // all 7 lasers on the impact
  FLAME(140.508); CO2(140.508, "g-co2", 1.2);
  CO2(143.435, CO2_OUT, 0.4); CO2(146.362, CO2_IN, 0.5); CO2(149.289, CO2_OUT, 0.4);
  // snare on beat 3: knife + full strobe + tower blinders
  [141.24, 142.703, 144.167, 145.63, 147.094, 148.557, 150.021].forEach((t) => {
    KNIFE(t, 1, 0, 0.7);
    H(t, "g-strobe", { dim: 1 }, { hold: 0.04, decay: 0.07, name: "Snare" });
  });
  [[150.752, -1], [151.02, 1], [151.3, -1], [151.48, 1], [151.85, -1]].forEach(([t, s]) => STUT(t, s, true, true));
  // measured bass returns in the explosion stutter bar (sub band): weak 151.06, strong 151.60
  BHIT(151.08, BND_B, 0.6, 0.1, "Bass-Stotter"); BHIT(151.61, BND_B, 1, 0.1, "Bass-Stotter");

  /* ================================================================ S15 Aufbau-Takt "Lunte II" (bar 105) */
  cue(152.216, "Aufbau", {
    block: true, camera: "drums",
    values: L(haze(1), V("g-riser", col("Rot"), { dim: 0.3 }), V(SPOT_C, col("Weiß"), beam("Eng"), { dim: 0 }), pos("Sänger", SPOT_C), V("g-beam", col("Weiß"), beam("Offen"), { dim: 0 }), pos("Senkrecht", "g-beam"),
      V("g-floor", col("Rot"), { dim: 0 }), pos("Senkrecht", "g-floor"), V("g-par", col("Rot"), { dim: 0 }), V("g-strobe", { dim: 0 })),
    effects: [DRUMMER(0.2, 0.15, 0.1)],
  });
  H(152.399, PARF, { dim: 1, r: 1, g: 0, b: 0 }, { hold: 0.1, decay: 0.35, color: true, shake: 0.5, name: "Sub-Boom" });
  H(152.399, BND_B, { dim: 1, r: 1, g: 0, b: 0 }, { hold: 0.05, decay: 0.15, color: true, name: "Sub-Boom" }); // bass gone by ≈ 152.7
  CO2(152.399, CO2_IN, 0.3);
  cue(152.741, "Aufbau – Fill", {
    add: true,
    values: L(V("g-strobe", { dim: 0.6 }), V(SPOT_O, col("Weiß"), beam("Offen"), { dim: 0 }), pos("Drums links", SPOT_OL), pos("Drums rechts", SPOT_OR)),
    effects: [RAMPA("g-strobe", "strobe", 152.741, 153.679, 6, 20, "Rampe Strobe Aufbau"), STEP(SPOT_O)],
  });
  PAIR(152.745, 1); PAIR(152.94, 2); H(152.94, STROBE_L, { dim: 1 }, { decay: 0.05, name: "Fill" });
  PAIR(153.135, 3); PAIR(153.32, 4); H(153.32, STROBE_R, { dim: 1 }, { decay: 0.05, name: "Fill" });
  H(153.2, BL_FRONT, { dim: 0.7 }, { decay: 0.12, name: "Ruf-Akzent" });
  H(153.2, SPOT_C, { dim: 1, ...W }, { decay: 0.12, color: true, name: "Ruf-Akzent" });

  /* ================================================================ S16 Finaler Refrain L1/L2 (bars 106–117) */
  cue(153.679, "Finaler Refrain", {
    block: true, camera: "crowd", color: HIT, note: "gemessener Anschlag, Funken-Debüt",
    values: L(haze(1), V("g-beam", col("Magenta"), beam("Offen"), beam("Prisma 3"), { dim: 1 }), pos("Fächer hoch", "g-beam"),
      V("g-floor", col("Cyan"), { dim: 1 }), pos("Fächer hoch", "g-floor"),
      V("g-spot", col("Weiß"), beam("Gobo Splitter"), { zoom: 16, dim: 1 }), pos("Fächer Publikum", "g-spot"),
      V("g-wash", col("Magenta"), { zoom: 22, dim: 1 }), pos("Bühne Mitte", "g-wash"),
      V("g-par", col("Cyan"), { dim: 0.8 }), V("g-riser", col("Weiß"), { dim: 1 }), V("g-bars", { dim: 1 }),
      lz(LZ_FLOOR, "Cyan", 3, 25, 24, { spd: 1.5, d: 1 }), lz(LZ_TOWER, "Cyan", 1, 70, 16, { spd: 0.5, d: 1 }),
      lz(LZ_TRUSS, "Magenta", 4, 60, 16, { d: 1 }), lz(LZ_TUN, "Magenta", 3, 30, 24, { spd: 1, d: 1 }),
      V(BND_BG, col("Magenta"), { dim: 1 }), V(BND_S, col("Cyan"), { dim: 0.65 })),
    effects: [PAT(PARF, K_CHOR, 0.16, 0.15), POS("g-beam", "fan", 30, 0.25, 0), BRIFF(K_BCH, 0.35, "Band-Groove"), ATTR("g-beam", "prismRot", "sine", -0.6, 0.6, { speed: 0.125 }),
      POS("g-spot", "circle", 14, 0.25, 180), CONSET("g-wash", "Magenta", "Gelb", 0.35), DRUMMER(0.3), RAINBOW(),
      CCHASE("g-laser", ["Cyan", "Magenta"], 0.25, 360, "Laser-Farbe"), ATTR(LZ_TOWER, "lzTilt", "sine", -10, 10, { speed: 0.25, phase: 180 }),
      ATTR(LZ_FLOOR, "lzSpeed", "sine", -2, 2, { speed: 0.125 })],
  });
  cue(155.143, "Finaler Refrain – Speichen", { camera: "sideL", values: V("g-spot", beam("Gobo Speichen")) });
  cue(156.606, "Finaler Refrain – Cyan", { values: V("g-beam", col("Cyan")) });
  cue(159.533, "Finaler Refrain – B", {
    camera: "crowdR",
    values: L(V("g-beam", col("Pink"), beam("Prisma 3")), pos("Fächer Publikum", "g-beam"), V("g-spot", col("Cyan"), beam("Gobo Speichen"), { goboSpin: 0.4 }),
      V("g-floor", col("Magenta"))),
  });
  cue(162.46, "Finaler Refrain – Kreuz", { camera: "crane", values: L(pos("Kreuz", "g-floor"), V("g-spot", col("Magenta"))) });
  cue(165.387, "Finaler Refrain – L2 Stotter-Takte", {
    camera: "back", add: true,
    values: L(V("g-beam", col("Weiß"), beam("Offen")), pos("Fächer Publikum", "g-beam"), V("g-floor", col("Weiß")),
      lz([LZ_FLOOR, LZ_TUN], null, 3, 30, 32, { spd: 1.5 }), lz(LZ_TOWER, null, 1, 90), V(BND_G, { dim: 0.35 })),
    effects: [ENVF(["g-beam", "g-wash", "g-laser", BND_B], "low", 0, "Bass-Schnitt")],
  });
  cam(166.85, "bass"); // stutter bar on the bassist
  cue(168.314, "Finaler Refrain – C", {
    camera: "guitar", kill: ["Bass-Schnitt"], values: L(V("g-beam", col("Cyan")), pos("Fächer hoch", "g-beam"), V("g-spot", { dim: 1 }), V(BND_G, { dim: 1 })),
  });
  cam(169.777, "drums"); // one bar on the guitarist (his podium flares up), then the duo (no crane fragment)
  DROP(153.679, 0.8); FLAME(153.679); CO2(153.679, "g-co2", 1.2); SPARK(153.679, SPK_FRONT, 1, 2.6);
  SPARK(159.533, SPK_FRONT, 0.75, 0.7); SPARK(165.387, SPK_FRONT, 1, 1.0); CO2(165.387, CO2_OUT, 0.4); // strongest crash of the last third
  [154.411, 155.874, 157.338, 158.801, 160.265, 161.728, 163.192, 164.655, 166.118, 169.045, 170.509].forEach((t) => KNIFE(t, 1, 1, 0.45));
  [[166.85, -1], [167.21, 1], [167.4, -1], [167.76, 1], [167.947, -1], [168.13, 1]].forEach(([t, s]) => STUT(t, s));
  [[166.882, CO2_OUT], [167.248, CO2_IN], [167.614, CO2_OUT], [167.98, CO2_IN]].forEach(([t, s]) => CO2(t, s, 0.15));

  /* ================================================================ S17 Höhepunkt 3 "Weißglut III" (bars 118–121) */
  cue(171.24, "Finaler Höhepunkt", {
    camera: "foh", add: true, kill: ["Groove", "Laser-Farbe"],
    values: L(V("g-beam", col("Rot"), beam("Offen")), pos("Fächer Publikum", "g-beam"), V("g-floor", col("Weiß")),
      V("g-spot", col("Rot"), beam("Offen"), { zoom: 24 }), pos("Publikum", "g-spot"), V("g-wash", col("Rot"), { dim: 1 }), V("g-par", col("Weiß"), { dim: 1 }),
      lz("g-laser", "Rot", 1, 90, 32, { spd: 1 }), lz(LZ_TUN, "Rot", 3, 30, 32), V(BND_BG, col("Weiß"), { dim: 1 }), V(BND_S, col("Rot"), { dim: 0.8 })),
    effects: [PAT(PARF, K_CLIM, 0.14, 0.15, 1, "abs", "Groove Höhepunkt"), PAT("g-strobe", SN3, 0.06, 0, 1, "abs", "Snare-Strobe"),
      ATTR("g-laser", "lzTilt", "sine", -12, 12, { speed: 0.5 })],
  });
  SPARK(171.24, SPK_RISER, 1, 5.8); // crash 171.24 comes from the crash tiers
  H(171.8, [BL_TOWER, "f701", "f704"], { dim: 1 }, { hold: 0.05, decay: 0.35, name: "Ruf 1" }); CO2(171.8, CO2_L, 0.5);
  // Ruf 2 on the measured vocal block (mid band jumps at 172.4); the song map's 173.25 is a Gemini-only estimate
  H(172.338, [BL_TOWER, "f702", "f703"], { dim: 1 }, { hold: 0.05, decay: 0.35, name: "Ruf 2" }); CO2(172.338, CO2_R, 0.5);
  cue(173.65, "Schrei 3", {
    camera: "front", add: true, kill: ["Snare-Strobe", "Regenbogen", "Pos circle"], note: "Rot-Glut, Weiß bleibt der Explosion: nur die Spots weiß auf dem Sänger",
    values: L(V(["g-floor", "g-bars", "g-beam", "g-wash", "g-par", "g-riser"], col("Rot"), { dim: 1 }),
      V("g-spot", col("Weiß"), beam("Eng"), { dim: 1 }), pos("Sänger", "g-spot"), lz([LZ_FLOOR, LZ_TUN], "Rot", 3, 20, 32), V("g-strobe", { dim: 0.5 }),
      V(BND, col("Rot"), { dim: 0.7 })),
    effects: [KPULS()],
  });
  cue(173.9, "Schrei 3 – Ton", {
    add: true,
    effects: [RAMPA("g-strobe", "strobe", 173.9, 176.5, 6, 20, "Rampe Strobe S3"), RAMPA("g-laser", "lzSpeed", 173.9, 176.5, 1, 4, "Rampe Laser S3"),
      RAMPD(BL_TOWER, 173.9, 176.5, 0.1, 0.6, "abs", "Rampe Blinder S3"), RAMPD(BND_S, 173.9, 176.5, 0.3, 1, "abs", "Rampe Synth S3")],
  });
  cue(173.901, "Schrei 3 – Konvergenz", { fade: 2.6, kill: ["Pos fan"], values: pos("Publikum", "g-beam", "g-floor") });
  cam(174.899, "singer"); // close-up once the flames are out
  cue(176.5, "Schrei 3 – Lösung", {
    fade: 0.6, kill: ["Rampe Strobe S3", "Rampe Laser S3", "Rampe Blinder S3", "Rampe Synth S3"], note: "Hoher Ton endet: Konvergenz öffnet, kein Dunkel",
    values: L(pos("Fächer hoch", "g-beam", "g-floor"), V("g-strobe", { dim: 0 }), V("g-blinder", { dim: 0 }), V(BND_S, { dim: 1 })),
  });
  // vocal peak (high note locks): third flame moment + outer CO2 (keeps the singer close-up clear) + all sparks
  SPARK(173.65, SPK_FRONT, 0.65, 0.25); SPARK(173.9, "g-spark", 1, 2.6); FLAME(173.9); CO2(173.9, CO2_OUT, 1.2);
  [171.972, 173.436, 174.899, 176.363].forEach((t) => KNIFE(t, 1, 0, 0.45));
  [172.338, 173.802, 175.265].forEach(KNIFE4);

  /* ================================================================ S18 Outro-Peak "Gold" L3/L4 (bars 122–133), gold #3 */
  cue(177.094, "Outro-Peak", {
    block: true, camera: "foh", color: HIT, note: "grüne Laser-Premiere, Farbwechsel ohne Drop (Klangwand läuft durch)",
    values: L(haze(1), V("g-beam", col("Gelb"), beam("Offen"), { dim: 1 }), pos("Fächer hoch", "g-beam"),
      V("g-floor", col("Rot"), { dim: 1 }), pos("Kreuz", "g-floor"),
      V("g-spot", col("Weiß"), beam("Gobo Splitter"), { zoom: 14, dim: 1 }), pos("Fächer Publikum", "g-spot"),
      V("g-wash", col("Orange"), { zoom: 22, dim: 1 }), pos("Bühne Mitte", "g-wash"),
      V("g-par", col("Rot"), { dim: 0.8 }), V("g-riser", col("Weiß"), { dim: 1 }), V("g-bars", { dim: 1 }),
      lz(LZ_FLOOR, "Grün", 3, 30, 24, { spd: 2, d: 0.6 }), lz(LZ_TOWER, "Grün", 1, 80, 24, { d: 1 }),
      lz(LZ_TRUSS, "Grün", 4, 60, 16, { d: 0.8 }), lz(LZ_TUN, "Grün", 3, 30, 32, { spd: 1.5, d: 1 }),
      V(BND_BG, col("Orange"), { dim: 1 }), V(BND_S, col("Gelb"), { dim: 1 })),
    effects: [POS("g-beam", "step", 20, 0.5, 0, { duty: 0.3 }), BRIFF(K_BCH, 0.35, "Band-Groove"), RAMPD(BND_S, 177.094, 181.4, 0.4, 1, "mul", "Synth steigt"), PAT("g-beam", HALF, 0.3, 0.75, 1, "mul", "Crash+Snare"), POS("g-spot", "random", 14, 0.5, 360),
      PAT(PARF, K_CHOR, 0.16, 0.15),
      CCHASE("g-wash", ["Orange", "Rot"], 0.5), CONSET("g-par", "Rot", "Weiß", 0.45), PAT("g-strobe", SN3, 0.06, 0, 1, "abs", "Snare-Strobe"),
      DRUMMER(0.3), PIX("chase", ["Gelb", "Rot"], 1, 0.12, 720), ATTR(LZ_TOWER, "lzFan", "sine", 40, 90, { speed: 0.125 }),
      ATTR("g-laser", "lzTilt", "sine", -10, 10, { speed: 0.25, phase: 180 })],
  });
  cue(180.021, "Outro – Rot", { camera: "synth", values: V("g-beam", col("Rot")) }); // one bar on the rising synth
  cue(181.484, "Outro – Synth zurück", { fade: 1, camera: "crowd", add: true, values: V(BND_S, { dim: 0.55 }), effects: [SINE(BND_S, 0.34, 0.6, "Synth atmet", 0)] });
  cue(182.948, "Outro – B", {
    camera: "wide",
    values: L(V("g-beam", col("Weiß"), beam("Prisma 3")), V("g-spot", col("Gelb"), beam("Gobo Speichen"), { goboSpin: 0.5 }), lz(LZ_TRUSS, "Weiß", 4, undefined, undefined, { d: 1 }),
      lz(LZ_FLOOR, null, undefined, undefined, undefined, { d: 1 }), V("g-par", { dim: 1 })), // one more step up into L4
  });
  cue(185.875, "Outro – Chants", { fade: 1, camera: "crane", values: L(V("g-spot", col("Warmweiß"), beam("Offen"), { zoom: 30 }), pos("Publikum", "g-spot")) });
  cue(186.79, "Chants – Puls", { add: true, effects: [PAT("g-blinder", HALF, 0.3, 0, 0.6, "abs", "Chant-Puls")] });
  cue(188.802, "Outro – L4", {
    camera: "crowdR", add: true, kill: ["Chant-Puls", "Crash+Snare", "Farb-Chase", "Pos step"], note: "alles auf, Weiß ins Publikum",
    values: L(V("g-beam", col("Weiß"), beam("Offen")), pos("Fächer Publikum", "g-beam"), V(["g-floor", "g-wash"], col("Weiß"), { dim: 1 }),
      V("g-spot", col("Weiß"), { dim: 1 }), pos("Publikum", "g-spot"), V(["g-par", "g-bars"], { dim: 1 }),
      lz("g-laser", "Weiß", undefined, undefined, undefined, { d: 1 }), lz([LZ_FLOOR, LZ_TUN], null, 3, undefined, 32, { spd: 3 }),
      V(BND_BG, col("Weiß"), { dim: 1 }), V(BND_S, col("Weiß"), { dim: 0.7 })),
    effects: [{ type: "dim", form: "chase", speed: 1, duty: 0.4, wings: 2, phase: 360, low: 0.8, high: 1, mode: "mul", targets: ["g-beam"], name: "Beam-Chase" },
      { ...POS("g-beam", "step", 20, 1, 0, { duty: 0.3 }), name: "Pos Sprung" }, PAT("g-blinder", SN24, 0.2, 0, 1, "abs", "Blinder 2+4")],
  });
  cue(190.265, "Stotter-Break", {
    camera: "drums", add: true, values: L(V("g-wash", { dim: 0.3 }), V(BND_G, { dim: 0.35 }), V(BND_S, { dim: 0.4 })),
    effects: [ENVF(["g-wash", "g-par", "g-floor", BND_B], "low", 0, "Bass-Schnitt"), PAT("g-laser", CHOP8, 0.06, 0, 1, "abs", "Laser-Chop")],
  });
  cue(191.729, "Outro – letzter Takt", { camera: "foh", kill: ["Bass-Schnitt", "Laser-Chop", "Blinder 2+4"], values: L(V("g-wash", { dim: 1 }), V(BND_G, { dim: 1 }), V(BND_S, { dim: 0.7 })) });
  cue(193.196, "Bass-Schnitt – Schwarz", {
    block: true, camera: "drums", note: "Fill-Note 1, Fill läuft über dem Schwarz",
    values: L(haze(1), V("g-beam", col("Weiß"), beam("Offen"), { dim: 0 }), pos("Senkrecht", "g-beam")),
  });
  cue(193.45, "Riser", {
    values: L(V("g-beam", col("Weiß"), beam("Offen"), { dim: 0.15 }), pos("Senkrecht", "g-beam"), V("g-par", col("Weiß"), { dim: 0.1 }),
      V("g-floor", col("Weiß"), { dim: 0.1 }), pos("Senkrecht", "g-floor"), V("g-strobe", { dim: 0.35 }),
      lz([LZ_FLOOR, LZ_TOWER], "Weiß", 0, undefined, 1, { d: 1 }), V("g-riser", col("Weiß"), { dim: 1 }),
      V("g-spot", col("Weiß"), beam("Offen"), { dim: 0 }), pos("Drums links", SPOT_OL), pos("Drums rechts", SPOT_OR), pos("Drums", SPOT_C),
      V(BND_S, col("Weiß"), { dim: 0.05 }), V(BND_B, col("Weiß"), { dim: 0.05 })),
    // the riser is the bass glide-up (sub band -32 → -7 dB): the bassist rises, the synth only half
    effects: [RAMPA("g-strobe", "strobe", 193.45, 194.53, 4, 22, "Rampe Strobe Riser"), RAMPD(BND_B, 193.45, 194.53, 0.05, 1, "abs", "Rampe Bass Riser"),
      RAMPD(BND_S, 193.45, 194.53, 0.04, 0.5, "abs", "Rampe Synth Riser"), RAMPD("g-blinder", 193.45, 194.53, 0, 0.5, "abs", "Rampe Blinder Riser"),
      RAMPD("g-beam", 193.45, 194.53, 0.1, 0.55, "abs", "Rampe Beams Riser"),
      RAMPD(PARF, 193.45, 194.53, 0.1, 1, "abs", "Rampe Boden"), RAMPA([LZ_FLOOR, LZ_TOWER], "lzTilt", 193.45, 194.53, -20, 20, "Rampe Laser Riser"),
      STEP("g-spot"), DRUMMER(0.3)],
  });
  cue(193.451, "Riser – Senken", { fade: 1.05, values: pos("Fächer Publikum", "g-beam") });
  cue(194.53, "Schwarz vor Finale", { block: true, values: haze(1), note: "letzte Fill-Note aus dem Schwarz, dann Finale" });
  FLAME(177.094, FLM_OUT); CO2(177.094, CO2_OUT, 0.5); // outro peak hit on the cut to the wide (flames idle since 173.9)
  SPARK(182.948, SPK_FRONT, 0.9, 1.4); SPARK(188.802, SPK_FRONT, 0.9, 1.4); CO2(188.802, CO2_IN, 0.5);
  [177.826, 179.289, 180.753, 182.216, 183.68, 185.143, 186.607, 188.07, 189.533, 192.46].forEach((t) => KNIFE(t, 1, 0, 0.45));
  [[190.63, -1], [190.81, 1], [191.18, -1], [191.55, 1]].forEach(([t, s]) => STUT(t, s));
  SPARK(193.45, SPK_RISER, 0.6, 1.15);
  // measured 12-note triplet fill (third-beat spacing): beam pairs walk out → in three times, strobes alternate, blinders close it
  // last note flashes out of the black at 194.53 and is gone before the finale attack
  [193.196, 193.316, 193.436, 193.564, 193.682, 193.802, 193.92, 194.042, 194.166, 194.29, 194.41, 194.53].forEach((t, i) => {
    const d = 0.6 + (0.4 * i) / 11, last = i === 11;
    PAIR(t, (i % 4) + 1, d, last ? 0.04 : 0.09);
    H(t, i % 2 ? STROBE_R : STROBE_L, { dim: d }, { decay: last ? 0.04 : 0.05, name: "Fill" });
    if (i >= 9) H(t, [BL_C, BL_FRONT, "g-blinder"][i - 9], { dim: 0.7 + 0.15 * (i - 9) }, { decay: last ? 0.05 : 0.12, name: "Fill" });
  });

  /* ================================================================ S19 Finale "Doppeltempo" L5 (bars 134–137) */
  cue(194.656, "FINALE", {
    block: true, camera: "crowd", color: HIT, note: "gemessener Anschlag, Doppeltempo",
    values: L(haze(1), V("g-beam", col("Rot"), beam("Offen"), { dim: 1 }), pos("Fächer Publikum", "g-beam"),
      V("g-floor", col("Weiß"), { dim: 1 }), pos("Fächer hoch", "g-floor"),
      V("g-spot", col("Weiß"), beam("Offen"), { zoom: 30, dim: 1 }), pos("Publikum", SPOT_O), V(SPOT_C, beam("Eng"), { zoom: 14 }), pos("Drums", SPOT_C),
      V("g-wash", col("Rot"), { zoom: 30, dim: 1 }), pos("Bühne Mitte", "g-wash"),
      V(["g-par", "g-riser"], col("Weiß"), { dim: 1 }), V("g-bars", col("Rot"), { dim: 1 }),
      lz(LZ_FLOOR, "Rot", 3, 35, 24, { d: 1 }), lz(LZ_TOWER, "Rot", 1, 90, 24, { d: 1 }),
      lz(LZ_TRUSS, "Weiß", 4, 60, 16, { d: 1 }), lz(LZ_TUN, "Rot", 3, 30, 32, { d: 1 }),
      V(BND_BG, col("Rot"), { dim: 1 }), V(BND_S, col("Weiß"), { dim: 0.8 })),
    effects: [PAT("g-beam", Q4, 0.15, 0.75, 1, "mul", "Jeder Schlag"), BRIFF(K_BFIN, 0.35, "Band-Groove"), POS("g-beam", "random", 25, 1, 0, { duty: 0.3 }),
      POS(SPOT_O, "random", 18, 1, 360, { duty: 0.3 }), PAT("g-strobe", "o.o.x.o.o.o.x.o.", 0.07, 0, 1, "abs", "Snare 2+4"), PAT(PARF, K_FIN, 0.12, 0.2),
      CONSET("g-wash", "Rot", "Weiß", 0.4), DRUMMER(0.3, 0.15, 0.1), PIX("chase", ["Weiß", "Rot"], 2, 0.1, 720),
      ATTR("g-laser", "lzSpeed", "square", -3, 3, { speed: 0.5 }), CCHASE("g-laser", ["Rot", "Weiß"], 0.5, 180, "Laser-Farbe"),
      PAT(BL_FRONT, Q4, 0.15, 0, 0.8, "abs", "Blinder-Puls")],
  });
  cue(196.119, "Finale – Weiß", { camera: "front", values: V("g-beam", col("Weiß"), beam("Prisma 3")) });
  cue(197.582, "Finale – Rot", { camera: "crowdR", values: L(V("g-beam", col("Rot"), beam("Offen")), V("g-floor", col("Rot"))) });
  cue(199.046, "Finale – Weiß-Rampe", {
    camera: "wide", add: true, kill: ["Blinder-Puls"], note: "Strobe-16tel und Weiß-Rampe in den Schluss-Fill",
    values: L(V("g-beam", beam("Prisma 3")), V(["g-wash", "g-par"], col("Weiß"))),
    effects: [RAMPD("g-blinder", 199.046, 199.776, 0.1, 1, "abs", "Rampe Weiß Finale"), PAT("g-strobe", "xxxxxxxxxxxxxxxx", 0.04, 0, 1, "abs", "Strobe 16tel")],
  });
  cue(199.776, "Schluss-Fill", {
    add: true, camera: "drums", kill: ["Snare 2+4", "Jeder Schlag", "Laser-Farbe", "Rampe Weiß Finale", "Strobe 16tel", "Pos random"],
    note: "Grundlicht runter, Fill-Noten blitzen in den Schlussschlag, alle Spots aufs Schlagzeug",
    values: L(V("g-beam", col("Weiß")), pos("Publikum", "g-beam"), V("g-spot", col("Weiß"), { dim: 0.4 }), pos("Drums links", SPOT_OL), pos("Drums rechts", SPOT_OR), lz("g-laser", "Weiß", 4, undefined, undefined, { d: 0.4 }),
      V(["g-wash", "g-par", "g-floor", "g-bars", BND], { dim: 0.3 }), V("g-blinder", { dim: 0 }), V("g-strobe", { dim: 0 })),
    effects: [STEP("g-beam"), STEP("g-spot")],
  });
  DROP(194.656, 0.8); FLAME(194.656); CO2(194.656, "g-co2", 1.0); SPARK(194.656, "g-spark", 0.8, 5.0); // stops before the final fill
  // crash bars: flames alternate inner / outer pair (≥ 1.46 s per unit), CO2 on 196.119 and 199.046
  FLAME(196.119, ["f1202", "f1203"]); CO2(196.119, CO2_OUT, 0.4);
  FLAME(197.582, FLM_OUT);
  FLAME(199.046, ["f1202", "f1203"]); CO2(199.046, "g-co2", 0.5);
  [195.021, 195.753, 196.485, 197.217, 197.948, 198.68, 199.412].forEach((t) => KNIFE(t, 1, 0, 1)); // towers: snare 2+4 over the front pulse
  // measured final fill: three 8ths, crescendo into the final hit
  [[199.776, STROBE_L, null], [199.96, STROBE_R, BL_C], [200.143, "g-strobe", BL_FRONT]].forEach(([t, s, b], i) => {
    H(t, s, { dim: 1 }, { decay: 0.06, name: "Schluss-Fill" });
    if (b) H(t, b, { dim: 0.6 + 0.2 * i }, { decay: 0.1, name: "Schluss-Fill" });
    PAIR(t, i + 2, 1, 0.1);
  });

  /* ================================================================ S20 Schlussschlag + Stille */
  const END = ["g-beam", "g-floor", "g-spot", "g-wash", "g-par", "g-riser", "g-bars", "g-laser", BND];
  cue(200.326, "SCHLUSSSCHLAG", {
    block: true, camera: "foh", color: HIT, note: "gemessener Anschlag",
    values: L(haze(1), V(["g-beam", "g-floor"], col("Weiß"), beam("Offen"), { dim: 1 }), pos("Publikum", "g-beam", "g-floor"),
      V("g-spot", col("Weiß"), beam("Offen"), { zoom: 20, dim: 1 }), pos("Bühne Mitte", "g-spot"),
      V("g-wash", col("Weiß"), { zoom: 50, dim: 1 }), pos("Bühne Mitte", "g-wash"), V(["g-par", "g-riser", "g-bars", BND], col("Weiß"), { dim: 1 }),
      V("g-strobe", { dim: 0 }), lz("g-laser", "Weiß", 2, 90, 32, { spd: 0, d: 1 })),
  });
  cue(200.55, "Ausklingen", { fade: 0.37, values: V(END, { dim: 0 }) });
  cue(200.92, "Stille", { block: true, camera: "wide", note: "Haze hängt nach" });
  // final-hit FX end with the ring-out: black and silent at 200.92
  H(200.326, "g-blinder", { dim: 1 }, { hold: 0.15, decay: 0.12, shake: 1, name: "Schlussschlag" });
  H(200.326, "g-strobe", { dim: 1 }, { hold: 0.08, decay: 0.1, name: "Schlussschlag" });
  FLAME(200.326); CO2(200.326, "g-co2", 0.25); SPARK(200.326, "g-spark", 1, 0.3);

  /* ---- camera-only cues, ids, effects */
  cues.sort((a, b) => a.time - b.time);
  for (const [t, shot] of cams) {
    const c = cues.find((x) => Math.abs(x.time - t) < 0.05);
    if (c) c.camera = shot;
    else cue(t, `Kamera – ${CAM_NAME[shot] || shot}`, { camera: shot });
  }
  cues.sort((a, b) => a.time - b.time);
  cues.forEach((c, i) => {
    const n = i + 1;
    c.id = `c${String(n).padStart(3, "0")}`;
    c.effects = c.effects.map((e, j) => ({ ...makeEffect(e), id: `e${n}-${j}` }));
  });
  hits.sort((a, b) => a.t - b.t);
  S.cues = cues;
  S.hits = hits;
  S.markers = SONG.sections.map(([time, name, color]) => ({ time, name, color }));
  S.modified = Date.now();
  S.stock = true; // untouched stock demo (state.mutate clears it)
  return S;
}
