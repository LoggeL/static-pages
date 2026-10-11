// LUMEN show model: event bus, patch/groups/presets/cues/executors, selection + programmer,
// undo/redo (show snapshots), persistence (localStorage + JSON) and the default rig.
// Importable in Node: no DOM access at module level, storage only inside try/catch.

import { FIXTURE_TYPES, getType, hasAttr, aimAt, SWATCHES, ATTR_KEYS, ATTRS, clamp } from "./fixtures.js";

export const SHOW_VERSION = 3; // bump → a stale stock demo in localStorage is replaced by the current demo; user shows are upgraded
// v3: one drum riser + frontman (mic / piano) instead of two drum risers + keys; validateShow migrates older stages
export const STORAGE_KEY = "lumen.show.v1";
export const DEMO_NAME = "Drum Show – Demo";
const HISTORY_MAX = 120;
const COALESCE_MS = 900;

let seq = 0;
export const uid = (p = "id") => `${p}${Date.now().toString(36).slice(-4)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const clone = (o) => (o === undefined ? o : JSON.parse(JSON.stringify(o)));
const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now()) / 1000;

/* ------------------------------------------------------------------ effects */
const DIM_FORMS = ["sine", "ramp", "rampDown", "square", "pulse", "random", "chase", "env", "onset", "pattern", "onsetStep"];
export const EFFECT_FORMS = {
  dim: DIM_FORMS,
  position: ["circle", "eight", "pan", "tilt", "wave", "fan", "random", "step"],
  color: ["rainbow", "chase", "onset", "env"],
  pixel: ["chase", "wave", "rainbow", "sparkle", "fill"],
  attr: DIM_FORMS,
};
// attributes an "attr" effect may modulate (attribute units, see ATTRS ranges)
export const EFFECT_ATTRS = ["zoom", "strobe", "w", "iris", "focus", "frost", "goboSpin", "prismRot", "lzTilt", "lzFan", "lzSpeed", "lzBeams", "lzPattern", "pan", "tilt", "dim"]
  .filter((k) => ATTRS[k]);
export const EFFECT_LABELS = {
  dim: "Dimmer", position: "Position", color: "Farbe", pixel: "Pixel", attr: "Attribut",
  sine: "Sinus", ramp: "Rampe ↑", rampDown: "Rampe ↓", square: "Rechteck", pulse: "Puls", random: "Zufall",
  chase: "Chase", env: "Audio-Hüllkurve", onset: "Drum-Onsets", circle: "Kreis", eight: "Acht", pan: "Pan-Schwenk",
  tilt: "Tilt-Schwenk", wave: "Welle", fan: "Fächer", rainbow: "Regenbogen", sparkle: "Funkeln", fill: "Füllen",
  pattern: "Step-Pattern", onsetStep: "Onset-Lauflicht", step: "Schritte",
};
export const EFFECT_DEFAULTS = {
  type: "dim", form: "sine", targets: [], sync: "beat", speed: 1, size: 1, low: 0, high: 1,
  phase: 360, wings: 0, dir: 1, duty: 0.5, offset: 0, mode: "mul", colors: [[1, 0, 0], [0, 0.15, 1]],
  sat: 1, band: "low", name: "",
};
// per-form extra defaults (only filled when the form uses them, so legacy effects stay lean)
const ONSET_FORMS = new Set(["onset", "onsetStep"]);
const FORM_KEYS = ["decay", "div", "pattern", "threshold", "every", "hold", "order"]; // form-specific params, dropped on a form change
const PHASELESS = new Set(["pattern", "onsetStep"]); // forms that default to phase 0
export function makeEffect(spec = {}) {
  const e = { ...clone(EFFECT_DEFAULTS), ...clone(spec) };
  if (!e.id) e.id = uid("e");
  if (!EFFECT_FORMS[e.type]) e.type = "dim";
  if (!EFFECT_FORMS[e.type].includes(e.form)) e.form = EFFECT_FORMS[e.type][0];
  if (e.type === "position" && spec.size === undefined) e.size = 30;
  if (e.type === "pixel" && spec.size === undefined) e.size = 0.35;
  if (e.type === "attr") {
    if (!ATTRS[e.attr]) e.attr = "zoom";
    const s = ATTRS[e.attr];
    if (spec.mode === undefined) e.mode = "abs";
    if (spec.low === undefined) e.low = s.min;
    if (spec.high === undefined) e.high = s.max;
  }
  if (e.form === "pattern" && e.type !== "position") {
    if (typeof e.pattern !== "string" || !e.pattern.length) e.pattern = "x...x...x...x...";
    e.div = Math.max(0.0625, +e.div || 4);
    e.decay = Math.max(0.005, +e.decay || 0.12);
    if (spec.phase === undefined) e.phase = 0;
  }
  if (ONSET_FORMS.has(e.form) && e.type !== "position") {
    if (e.form === "onsetStep" && spec.phase === undefined) e.phase = 0;
    if (e.form === "onsetStep" && e.decay === undefined) e.decay = 0.25;
    if (e.type === "color" && e.decay === undefined) e.decay = 0.11;
  }
  if (e.threshold !== undefined) e.threshold = clamp(+e.threshold || 0, 0, 1);
  if (e.every !== undefined) e.every = Math.max(1, Math.round(+e.every || 1));
  if (e.decay !== undefined) e.decay = Math.max(0.005, +e.decay || 0.005);
  return e;
}

// normalises one show.hits entry ({t, targets, attrs, decay, hold, color?, stagger?, shake?, name?}); null if invalid
export function makeHit(h) {
  if (!h || typeof h.t !== "number" || !Number.isFinite(h.t)) return null;
  const targets = (Array.isArray(h.targets) ? h.targets : h.targets ? [h.targets] : []).filter((x) => typeof x === "string");
  if (!targets.length) return null;
  const attrs = {};
  for (const k in h.attrs || { dim: 1 }) {
    const v = (h.attrs || { dim: 1 })[k];
    if (ATTRS[k] && typeof v === "number" && Number.isFinite(v)) attrs[k] = v;
  }
  const out = { t: h.t, targets, attrs };
  for (const k of ["decay", "hold", "stagger", "shake"]) if (typeof h[k] === "number" && Number.isFinite(h[k])) out[k] = h[k];
  if (out.decay !== undefined) out.decay = Math.max(0.005, out.decay);
  if (out.hold !== undefined) out.hold = Math.max(0, out.hold);
  if (typeof h.color === "boolean") out.color = h.color;
  if (h.name) out.name = String(h.name);
  return out;
}

/* ------------------------------------------------------------------ venue & default rig */
export function createVenue() {
  return {
    hall: { w: 34, d: 44, h: 14, zFront: 30, zBack: -9 },
    stage: { w: 14, d: 8, h: 1.2, z0: -4, z1: 4 },
    trusses: [
      { id: "t-front", name: "Front-Truss", x0: -7.6, x1: 7.6, y: 8.0, z: 3.2 },
      { id: "t-mid", name: "Mid-Truss", x0: -7.6, x1: 7.6, y: 9.0, z: 0 },
      { id: "t-back", name: "Back-Truss", x0: -7.6, x1: 7.6, y: 9.5, z: -3.4 },
    ],
    towers: [
      { id: "tw-l", name: "Turm links", x: -7.7, z: 1.0, h: 6.5 },
      { id: "tw-r", name: "Turm rechts", x: 7.7, z: 1.0, h: 6.5 },
    ],
    // one drum riser upstage centre: kit + seated drummer, LED fascia glows with the fascia group
    risers: [{ id: "r-drum", name: "Drum-Riser", x: 0, z: -1.7, w: 4.2, d: 2.8, h: 1.4, kit: true, fascia: "g-riser" }],
    // frontman: mic stand downstage centre, grand piano stage left (= house right, +x); yaw in deg (0 = player faces +x)
    band: { mic: { x: 0, z: 2.4 }, piano: { x: 3.3, z: 0.6, yaw: 30 } },
    backdrop: { z: -4.6, h: 11 },
    audience: { z0: 6, z1: 24, rows: 14 },
  };
}

// Band positions derived from the venue (shared by presets, viz and camera): drummer seat, singer at the mic,
// pianist on the bench. Piano frame: origin = keyboard front centre, local +x = where the player faces, +z = player's right.
export function bandSpots(v = createVenue()) {
  const SH = v.stage?.h ?? 1.2;
  const R = (v.risers || []).find((r) => r.kit) || (v.risers || [])[0] || { x: 0, z: -1.7, w: 4.2, d: 2.8, h: 1.4 };
  const mic = v.band?.mic || { x: 0, z: 2 }, pn = v.band?.piano || { x: 3.3, z: 0.6, yaw: 30 };
  const a = ((pn.yaw || 0) * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
  const pw = (lx, lz) => ({ x: pn.x + lx * ca - lz * sa, z: pn.z + lx * sa + lz * ca });
  const kitZ = R.z + 0.25; // kit origin (riser centre, nudged downstage)
  return {
    SH, riser: R, top: SH + R.h,
    kit: { x: R.x, y: SH + R.h, z: kitZ },
    drummer: { x: R.x, y: SH + R.h, z: kitZ - 0.42 },
    mic: { x: mic.x, z: mic.z }, // stand
    singer: { x: mic.x, z: mic.z - 0.38, yaw: 0 }, // standing spot, faces the audience (+z)
    piano: { x: pn.x, z: pn.z, yaw: pn.yaw || 0, at: pw },
    bench: { ...pw(-0.62, 0), yaw: pn.yaw || 0 }, // seated pianist
    pianoWalk: pw(-0.62, 0.78), // where he stands up / sits down (downstage side of the bench)
  };
}

// Builds the 77-fixture demo rig. Ids are "f" + fixture number (fid).
export function createDefaultRig(venue = createVenue()) {
  const fixtures = [];
  const add = (fid, type, name, universe, address, pos, mount = "hang", extra = {}) => {
    fixtures.push({ id: `f${fid}`, fid, type, name, universe, address, pos: pos.map((v) => Math.round(v * 1000) / 1000), mount, yaw: 0, orient: { pan: 0, tilt: 0 }, ...extra });
  };
  const row8 = (i) => -6.125 + i * 1.75;
  const SH = venue.stage.h;

  [-6.25, -3.75, -1.25, 1.25, 3.75, 6.25].forEach((x, i) => add(101 + i, "wash", `Wash ${i + 1}`, 1, 1 + i * 15, [x, 7.72, 3.2]));
  for (let i = 0; i < 8; i++) add(201 + i, "spot", `Spot ${i + 1}`, 1, 101 + i * 20, [row8(i), 8.7, 0]);
  for (let i = 0; i < 8; i++) add(301 + i, "beam", `Beam ${i + 1}`, 1, 261 + i * 14, [row8(i), 9.2, -3.4]);
  [-6, -4, 4, 6].forEach((x, i) => add(311 + i, "beam", `Bodenbeam ${i + 1}`, 1, 381 + i * 14, [x, SH, -3.15], "floor"));

  for (let i = 0; i < 8; i++)
    add(401 + i, "bar", `Pixel-Bar ${i + 1}`, 2, 1 + i * 26, [row8(i), SH + 0.06, -3.85], "floor", { orient: { pan: 0, tilt: 35 } });
  [-5, -3, -1, 1, 3, 5].forEach((x, i) =>
    add(501 + i, "par", `Front-PAR ${i + 1}`, 2, 221 + i * 6, [x, SH + 0.13, 3.7], "floor", { orient: { pan: 180, tilt: 32 } }));
  const B = bandSpots(venue), R = B.riser, RT = B.top, RF = R.z + R.d / 2;
  // riser PARs on the riser deck: L = f511 front / f512 back, R = f513 front / f514 back, all on the drummer
  [[-1, 1], [-1, -1], [1, 1], [1, -1]].forEach(([s, fz], i) => {
    const f = { type: "par", mount: "floor", yaw: 0, pos: [R.x + s * (R.w / 2 - 0.28), RT + 0.13, R.z + fz * (R.d / 2 - 0.28)] };
    add(511 + i, "par", `Riser-PAR ${i + 1}`, 2, 261 + i * 6, f.pos, "floor", { orient: aimAt(f, [B.drummer.x, RT + 1.1, B.drummer.z]) });
  });
  [-5.25, -1.75, 1.75, 5.25].forEach((x, i) =>
    add(601 + i, "strobe", `Strobe ${i + 1}`, 2, 301 + i * 4, [x, 8.75, 0.35], "hang", { orient: { pan: 0, tilt: 45 } }));
  [-5, -2.5, 2.5, 5].forEach((x, i) =>
    add(701 + i, "blinder4", `Blinder ${i + 1}`, 2, 321 + i * 4, [x, 7.75, 3.45], "hang", { orient: { pan: 0, tilt: 72 } }));
  venue.towers.forEach((t, i) => {
    const f = { type: "blinder2", mount: "floor", yaw: 0, pos: [t.x, SH + 5.2, t.z + 0.3] };
    add(705 + i, "blinder2", `Turm-Blinder ${i + 1}`, 2, 341 + i * 2, f.pos, "floor", { orient: aimAt(f, [t.x * 0.5, 2, 16]) });
  });
  [-1.5, 1.5].forEach((x, i) =>
    add(801 + i, "laser", `Laser ${i + 1}`, 3, 1 + i * 10, [R.x + x, SH + 0.1, RF + 0.22], "floor", { orient: { pan: 0, tilt: 84 } })); // at the riser foot
  [-7.2, 7.2].forEach((x, i) => add(901 + i, "hazer", `Hazer ${i + 1}`, 3, 21 + i * 2, [x, SH, -3.6], "floor"));
  // extra lasers: tower tops (crossing over the crowd), back truss (over stage + crowd), mid truss centre (tunnels)
  const lz = (fid, name, address, pos, mount, aim) => {
    const f = { type: "laser", mount, yaw: 0, pos };
    add(fid, "laser", name, 3, address, pos, mount, { orient: aimAt(f, aim) });
  };
  venue.towers.forEach((t, i) => lz(803 + i, `Turm-Laser ${i + 1}`, 31 + i * 10, [t.x, t.h + 0.06, t.z], "floor", [-t.x * 0.35, 3.4, 24]));
  [-3.5, 3.5].forEach((x, i) => lz(805 + i, `Truss-Laser ${i + 1}`, 51 + i * 10, [x, 9.25, -3.4], "hang", [x * 2.2, 2.8, 26]));
  lz(807, "Truss-Laser Mitte", 71, [0, 8.75, 0], "hang", [0, 4.4, 24]);
  // stage FX (universe 4): sparkulars front + on the riser front corners, CO2 jets downstage, flame projectors upstage
  [-6.4, -4.2, 4.2, 6.4].forEach((x, i) => add(1001 + i, "spark", `Sparkular ${i + 1}`, 4, 1 + i * 2, [x, SH, 3.82], "floor"));
  [-1, 1].forEach((s, i) => add(1005 + i, "spark", `Sparkular Riser ${i + 1}`, 4, 9 + i * 2, [R.x + s * (R.w / 2 - 0.3), RT, RF - 0.22], "floor"));
  [-6.6, -2.2, 2.2, 6.6].forEach((x, i) => add(1101 + i, "co2", `CO2-Jet ${i + 1}`, 4, 21 + i, [x, SH, 3.35], "floor"));
  [-6.5, -5, 5, 6.5].forEach((x, i) => add(1201 + i, "flame", `Flamme ${i + 1}`, 4, 31 + i * 2, [x, SH, -2.35], "floor"));

  const ids = (from, n) => Array.from({ length: n }, (_, i) => `f${from + i}`);
  const G = (id, name, fixtures, color) => ({ id, name, fixtures, color });
  const groups = [
    G("g-wash", "Front-Wash", ids(101, 6), "#ffb000"),
    G("g-spot", "Spots", ids(201, 8), "#3ec5ff"),
    G("g-spot-l", "Spots links", ids(201, 4), "#3ec5ff"),
    G("g-spot-r", "Spots rechts", ids(205, 4), "#3ec5ff"),
    G("g-beam", "Beams Truss", ids(301, 8), "#b48cff"),
    G("g-floor", "Beams Boden", ids(311, 4), "#b48cff"),
    G("g-movers", "Alle Movingheads", [...ids(101, 6), ...ids(201, 8), ...ids(301, 8), ...ids(311, 4)], "#ff7a59"),
    G("g-bars", "Pixel-Bars", ids(401, 8), "#44d17a"),
    G("g-par", "Front-PARs", ids(501, 6), "#ff5ea8"),
    G("g-riser", "Riser-PARs", ids(511, 4), "#ff5ea8"),
    G("g-drum-l", "Drums links", ["f511", "f512"], "#ff5ea8"), // left / right half of the one kit
    G("g-drum-r", "Drums rechts", ["f513", "f514"], "#ff5ea8"),
    G("g-strobe", "Strobes", ids(601, 4), "#e6edf5"),
    G("g-blinder", "Blinder", ids(701, 6), "#ffd27a"),
    G("g-laser", "Laser", ids(801, 7), "#44d17a"),
    G("g-haze", "Hazer", ids(901, 2), "#8b95a3"),
    G("g-laser-floor", "Laser Boden", ids(801, 2), "#44d17a"),
    G("g-laser-tower", "Laser Türme", ids(803, 2), "#44d17a"),
    G("g-laser-top", "Laser Truss", ids(805, 3), "#44d17a"),
    G("g-spark", "Sparkulars", ids(1001, 6), "#ffe08a"),
    G("g-spark-front", "Sparkulars vorne", ids(1001, 4), "#ffe08a"),
    G("g-spark-riser", "Sparkulars Riser", ids(1005, 2), "#ffe08a"),
    G("g-co2", "CO2-Jets", ids(1101, 4), "#cfe8ff"),
    G("g-flame", "Flammen", ids(1201, 4), "#ff6a1a"),
  ];
  return { fixtures, groups };
}

// band position presets (name → aim point); "Drums links/rechts" = left / right half of the one kit
function bandAims(venue) {
  const B = bandSpots(venue), D = B.drummer, hy = B.top + 0.95, kb = B.piano.at(-0.3, 0);
  return [
    ["Drums", [D.x, hy, D.z]], ["Drums links", [D.x - 0.7, hy, D.z]], ["Drums rechts", [D.x + 0.7, hy, D.z]],
    ["Sänger", [B.singer.x, B.SH + 1.5, B.singer.z]], ["Piano", [kb.x, B.SH + 1.05, kb.z]],
  ];
}
// cue.performer: where the frontman is (tracked like cue.camera; the viz walks him there)
export const PERFORMER_PLACES = ["mic", "piano"];
// old preset names → current ones (the demo and old shows may still say "Keys/Mikro")
export const PRESET_ALIASES = { "Keys/Mikro": "Sänger" };

/* ---- ≤ v2 stage migration: two drum risers + keys → one riser + frontman */
// stock positions of the fixtures that moved with the riser (only fixtures still at these spots are moved)
const LEGACY_POS = {
  f511: [-4.15, 1.33, 0.1], f512: [-1.05, 1.33, 0.1], f513: [1.05, 1.33, 0.1], f514: [4.15, 1.33, 0.1],
  f801: [-1.2, 1.3, -3.2], f802: [1.2, 1.3, -3.2], f1005: [-2.6, 1.8, -0.52], f1006: [2.6, 1.8, -0.52],
};
const LEGACY_AIM = { "Drums links": [-2.6, 2.8, -1.6], "Drums rechts": [2.6, 2.8, -1.6], "Keys/Mikro": [0, 2.6, 1.4] };
const LEGACY_SHOTS = { drumsL: "drums", drumsR: "drums" };
const near = (a, b) => Array.isArray(a) && a.length === 3 && a.every((x, k) => Math.abs(x - b[k]) < 1e-3);
function migrateStage(s) {
  const base = createVenue(), rig = createDefaultRig(base);
  s.venue.risers = base.risers;
  s.venue.band = base.band;
  delete s.venue.keys;
  for (const f of s.fixtures) {
    const nf = LEGACY_POS[f.id] && near(f.pos, LEGACY_POS[f.id]) && rig.fixtures.find((x) => x.id === f.id && x.type === f.type);
    if (nf) { f.pos = nf.pos.slice(); f.orient = { ...nf.orient }; }
  }
  // stock band presets: re-aim, "Keys/Mikro" → "Sänger", add "Drums" / "Piano" after them
  const aims = new Map(bandAims(base));
  s.presets = s.presets.map((p) => (p && typeof p === "object" ? { ...p } : p));
  const pos = s.presets.filter((p) => p && p.kind === "position");
  let last = null;
  for (const p of pos) {
    if (!LEGACY_AIM[p.name] || !near(p.aim, LEGACY_AIM[p.name])) continue;
    p.name = PRESET_ALIASES[p.name] || p.name;
    p.aim = aims.get(p.name).slice();
    if (!last || s.presets.indexOf(p) > s.presets.indexOf(last)) last = p;
  }
  if (last) {
    // same order as a fresh rig: "Drums" before "Drums links", "Piano" after "Sänger" (else after the last re-aimed one)
    for (const [n, ref, after] of [["Drums", "Drums links", 0], ["Piano", "Sänger", 1]]) {
      if (pos.some((p) => p.name === n)) continue;
      const r = s.presets.findIndex((p) => p && p.kind === "position" && p.name === ref);
      s.presets.splice(r >= 0 ? r + after : s.presets.indexOf(last) + 1, 0, { id: uid("p-position-"), kind: "position", name: n, color: null, aim: aims.get(n).slice() });
    }
  }
  for (const c of s.cues) if (LEGACY_SHOTS[c.camera]) c.camera = LEGACY_SHOTS[c.camera];
  // pan/tilt baked into cues / executors from a stock band aim (within 0.05°) follow the re-aimed preset
  const legacy = Object.entries(LEGACY_AIM).map(([n, aim]) => [aim, aims.get(PRESET_ALIASES[n] || n)]);
  const fx = new Map(s.fixtures.map((f) => [f.id, f]));
  const rebake = (h) => {
    let vals = h.values;
    for (const id in vals || {}) {
      const v = vals[id], f = fx.get(id);
      if (!v || typeof v.pan !== "number" || typeof v.tilt !== "number" || !f || !getType(f.type)?.caps.pantilt) continue;
      for (const [old, now] of legacy) {
        const a = aimAt(f, old);
        if (Math.abs(a.pan - v.pan) > 0.05 || Math.abs(a.tilt - v.tilt) > 0.05) continue;
        if (vals === h.values) vals = h.values = { ...vals };
        vals[id] = { ...v, ...aimAt(f, now) };
        break;
      }
    }
  };
  s.cues.forEach(rebake);
  s.executors = s.executors.map((x) => (x && typeof x === "object" ? (rebake((x = { ...x })), x) : x));
}

export function createDefaultPresets(rig, venue = createVenue()) {
  const presets = [];
  const P = (kind, name, data, color) => presets.push({ id: `p-${kind}-${presets.length + 1}`, kind, name, color: color || null, ...data });
  for (const s of SWATCHES) {
    const [r, g, b, w] = s.rgbw;
    P("color", s.name, { attrs: { r, g, b, w } }, `rgb(${Math.round(Math.min(1, r + w * 0.5) * 255)},${Math.round(Math.min(1, g + w * 0.5) * 255)},${Math.round(Math.min(1, b + w * 0.5) * 255)})`);
  }
  const SH = venue.stage.h;
  const movers = rig.fixtures.filter((f) => getType(f.type)?.caps.pantilt);
  const per = (fn) => Object.fromEntries(movers.map((f) => [f.id, aimAt(f, fn(f))]));
  P("position", "Senkrecht", { attrs: { pan: 0, tilt: 0 } });
  P("position", "Bühne Mitte", { aim: [0, SH, 0.5] });
  for (const [name, aim] of bandAims(venue)) P("position", name, { aim });
  P("position", "Publikum", { aim: [0, 1.7, 14] });
  P("position", "Fächer hoch", { perFixture: per((f) => [f.pos[0] * 2.6, 13, f.pos[2] + 9]) });
  P("position", "Fächer Publikum", { perFixture: per((f) => [f.pos[0] * 2.2, 2, 18]) });
  P("position", "Kreuz", { perFixture: per((f) => [-f.pos[0] * 1.1, SH, 1.5]) });
  P("position", "Raster Boden", { perFixture: per((f) => [f.pos[0] * 0.9, SH, f.pos[2] * 0.5 + 0.8]) });
  P("beam", "Offen", { attrs: { gobo: 0, prism: 0, frost: 0, iris: 1, goboSpin: 0, prismRot: 0 } });
  P("beam", "Eng", { attrs: { zoom: 8, iris: 0.7, frost: 0 } });
  P("beam", "Weit", { attrs: { zoom: 40, iris: 1 } });
  P("beam", "Gobo Punkte", { attrs: { gobo: 1, focus: 0.55, goboSpin: 0.25 } });
  P("beam", "Gobo Speichen", { attrs: { gobo: 2, focus: 0.55, goboSpin: -0.3 } });
  P("beam", "Gobo Splitter", { attrs: { gobo: 4, focus: 0.5 } });
  P("beam", "Prisma 3", { attrs: { prism: 1, prismRot: 0.3 } });
  P("beam", "Prisma linear", { attrs: { prism: 2, prismRot: 0 } });
  P("beam", "Frost", { attrs: { frost: 1 } });
  P("dim", "Voll", { attrs: { dim: 1 } });
  P("dim", "Halb", { attrs: { dim: 0.5 } });
  P("dim", "Aus", { attrs: { dim: 0 } });
  return presets;
}

export function createDefaultExecutors() {
  return [
    { id: "x-blinder", name: "Blinder", key: "b", mode: "flash", kind: "values", color: "#ffd27a", fade: 0, release: 0.35,
      values: { "g-blinder": { dim: 1 } }, effects: [] },
    { id: "x-strobe", name: "Strobe", key: "s", mode: "flash", kind: "values", color: "#e6edf5", fade: 0, release: 0,
      values: { "g-strobe": { dim: 1, strobe: 14 }, "g-bars": { dim: 1, r: 1, g: 1, b: 1, strobe: 14 } }, effects: [] },
    { id: "x-white", name: "Weiß-Flash", key: "w", mode: "flash", kind: "values", color: "#ffffff", fade: 0, release: 0.25,
      values: { "g-wash": { dim: 1, r: 1, g: 1, b: 1, w: 1 }, "g-par": { dim: 1, r: 1, g: 1, b: 1, w: 1 } }, effects: [] },
    { id: "x-laser", name: "Laser", key: "l", mode: "toggle", kind: "values", color: "#44d17a", fade: 0.2, release: 0.2,
      values: { "g-laser": { dim: 1, r: 0, g: 1, b: 0.2, lzPattern: 1, lzFan: 60, lzBeams: 16 } },
      effects: [{ ...makeEffect({ type: "dim", form: "square", targets: ["g-laser"], speed: 0.5, duty: 0.6, mode: "mul" }), id: "e-x-laser" }] },
    { id: "x-fog", name: "Fog", key: "f", mode: "flash", kind: "values", color: "#8b95a3", fade: 0, release: 0,
      values: { "g-haze": { dim: 1 } }, effects: [] },
    { id: "x-blackout", name: "Blackout", key: "x", mode: "flash", kind: "blackout", color: "#ff4d5e", fade: 0, release: 0, values: {}, effects: [] },
    // stage FX: fire while held (a flame fires its ≥ 0.7 s burst per press)
    { id: "x-spark", name: "Funken", key: "k", mode: "flash", kind: "values", color: "#ffc24a", fade: 0, release: 0,
      values: { "g-spark": { dim: 1 } }, effects: [] },
    { id: "x-co2", name: "CO2", key: "c", mode: "flash", kind: "values", color: "#cfe3ff", fade: 0, release: 0,
      values: { "g-co2": { dim: 1 } }, effects: [] },
    { id: "x-flame", name: "Flammen", key: "v", mode: "flash", kind: "values", color: "#ff6a1a", fade: 0, release: 0,
      values: { "g-flame": { dim: 1 } }, effects: [] },
  ];
}

export function createShow(opts = {}) {
  const venue = createVenue();
  const rig = opts.empty ? { fixtures: [], groups: [] } : createDefaultRig(venue);
  const t = Date.now();
  return {
    version: SHOW_VERSION,
    name: opts.name || "Neue Show",
    created: t, modified: t,
    venue,
    fixtures: rig.fixtures,
    groups: rig.groups,
    presets: opts.empty ? [] : createDefaultPresets(rig, venue),
    executors: createDefaultExecutors(),
    cues: [],
    hits: [],
    markers: [],
    audio: { src: "./audio/drum-show.mp3", title: "", artist: "", duration: 204.01, bpm: 120, beatsPerBar: 4, downbeat: 0, offset: 0, beats: [], segments: [] },
    settings: { fadeDefault: 1, snap: "beat" },
  };
}

// Copies the beat grid / meta of an analysis JSON into show.audio.
export function applyAnalysis(show, an) {
  if (!an) return show;
  Object.assign(show.audio, {
    title: an.title || show.audio.title, artist: an.artist || show.audio.artist,
    duration: an.duration || show.audio.duration, bpm: an.bpm || show.audio.bpm,
    beats: Array.isArray(an.beats) ? an.beats.slice() : [], segments: Array.isArray(an.segments) ? an.segments.slice() : [],
  });
  return show;
}

// Normalises an imported/parsed show; throws on garbage.
export function validateShow(o) {
  if (!o || typeof o !== "object" || !Array.isArray(o.fixtures)) throw new Error("Keine gültige LUMEN-Show");
  const base = createShow({ empty: true });
  const s = { ...base, ...o };
  s.version = SHOW_VERSION;
  s.venue = { ...base.venue, ...(o.venue || {}) };
  s.audio = { ...base.audio, ...(o.audio || {}) };
  s.settings = { ...base.settings, ...(o.settings || {}) };
  for (const k of ["groups", "presets", "executors", "cues", "markers", "hits"]) if (!Array.isArray(s[k])) s[k] = [];
  s.fixtures = s.fixtures.filter((f) => f && f.id && getType(f.type)).map((f) => ({
    mount: "hang", yaw: 0, orient: { pan: 0, tilt: 0 }, universe: 1, address: 1, pos: [0, 5, 0], name: f.id, fid: 0, ...f,
  }));
  s.cues = s.cues.map((c) => {
    const o = { fade: 1, delay: 0, values: {}, effects: [], kill: [], block: false, note: "", name: "Cue", ...c };
    if (!Array.isArray(o.effects)) o.effects = [];
    if (!Array.isArray(o.kill)) o.kill = [];
    if (o.fxMode !== "add") delete o.fxMode; // "replace" is the default
    if (typeof o.camera !== "string" || !o.camera) delete o.camera;
    if (!PERFORMER_PLACES.includes(o.performer)) delete o.performer;
    return o;
  });
  s.cues.sort((a, b) => a.time - b.time);
  s.hits = s.hits.map(makeHit).filter(Boolean).sort((a, b) => a.t - b.t);
  if (!(o.version >= 3)) migrateStage(s);
  return s;
}

/* ------------------------------------------------------------------ state */
export function createState(initialShow) {
  const listeners = new Map();
  let index = null, saveTimer = null, coalesce = null;

  const S = {
    show: initialShow ? validateShow(initialShow) : createShow(),
    analysis: null,
    transport: { t: 0, playing: false, duration: 204.01, loop: null, rate: 1 },
    live: { grandmaster: 1, blackout: false, executors: {}, tap: null },
    programmer: { selection: [], values: {}, effects: [] },
    ui: { camera: "foh", cueId: null, snap: true, beams: true, labels: false, haze: 0.55, quality: "hoch", follow: true, pxPerSec: 40 },
    history: { undo: [], redo: [] },
    autosave: true,
  };

  /* ---- bus */
  S.on = (evt, fn) => {
    if (!listeners.has(evt)) listeners.set(evt, new Set());
    listeners.get(evt).add(fn);
    return () => S.off(evt, fn);
  };
  S.off = (evt, fn) => listeners.get(evt)?.delete(fn);
  S.emit = (evt, payload = {}) => {
    for (const fn of [...(listeners.get(evt) || []), ...(listeners.get("*") || [])]) {
      try { fn(payload, evt); } catch (e) { console.error(`[lumen] listener ${evt}`, e); }
    }
  };
  S.status = (text, kind = "info") => S.emit("status", { text, kind });

  /* ---- lookup */
  const reindex = () => {
    index = { f: new Map(), g: new Map(), p: new Map(), x: new Map() };
    for (const f of S.show.fixtures) index.f.set(f.id, f);
    for (const g of S.show.groups) index.g.set(g.id, g);
    for (const p of S.show.presets) index.p.set(p.id, p);
    for (const x of S.show.executors) index.x.set(x.id, x);
  };
  const idx = () => index || (reindex(), index);
  S.fixture = (id) => idx().f.get(id) || null;
  S.group = (id) => idx().g.get(id) || null;
  S.preset = (id) => idx().p.get(id) || null;
  S.executor = (id) => idx().x.get(id) || null;
  S.def = (id) => getType(S.fixture(id)?.type);
  S.cue = (id) => S.show.cues.find((c) => c.id === id) || null;
  S.isGroup = (id) => idx().g.has(id);
  // targets (fixture and/or group ids) → ordered, de-duplicated fixture ids
  S.resolve = (targets = []) => {
    const out = [], seen = new Set();
    const push = (id) => { if (!seen.has(id) && idx().f.has(id)) { seen.add(id); out.push(id); } };
    for (const t of targets) {
      const g = idx().g.get(t);
      if (g) g.fixtures.forEach(push); else push(t);
    }
    return out;
  };
  S.groupsOf = (fid) => S.show.groups.filter((g) => g.fixtures.includes(fid)).map((g) => g.id);

  /* ---- history / mutation */
  const snapshot = () => JSON.stringify(S.show);
  const historyChanged = (label) => S.emit("history:changed", { canUndo: S.canUndo(), canRedo: S.canRedo(), label });
  S.canUndo = () => S.history.undo.length > 0;
  S.canRedo = () => S.history.redo.length > 0;
  S.mutate = (label, fn, opts = {}) => {
    const scope = opts.scope || "all";
    const t = now();
    const merge = opts.coalesce && coalesce && coalesce.key === opts.coalesce && t - coalesce.t < COALESCE_MS;
    if (!merge) {
      S.history.undo.push({ label, json: snapshot() });
      if (S.history.undo.length > HISTORY_MAX) S.history.undo.shift();
    }
    coalesce = opts.coalesce ? { key: opts.coalesce, t } : null;
    S.history.redo.length = 0;
    const result = fn(S.show);
    S.show.modified = Date.now();
    if (S.show.stock) S.show.stock = false;
    if (scope === "cues" || scope === "all") S.show.cues.sort((a, b) => a.time - b.time);
    reindex();
    S.emit("show:changed", { label, scope });
    historyChanged(label);
    scheduleSave();
    return result;
  };
  const restore = (json, label) => {
    S.show = validateShow(JSON.parse(json));
    reindex();
    pruneProgrammer();
    S.emit("show:changed", { label, scope: "all" });
    historyChanged(label);
    scheduleSave();
  };
  S.undo = () => {
    const e = S.history.undo.pop();
    if (!e) return false;
    S.history.redo.push({ label: e.label, json: snapshot() });
    coalesce = null;
    restore(e.json, `Rückgängig: ${e.label}`);
    S.status(`Rückgängig: ${e.label}`);
    return true;
  };
  S.redo = () => {
    const e = S.history.redo.pop();
    if (!e) return false;
    S.history.undo.push({ label: e.label, json: snapshot() });
    coalesce = null;
    restore(e.json, `Wiederholen: ${e.label}`);
    S.status(`Wiederholen: ${e.label}`);
    return true;
  };

  /* ---- load / persistence */
  S.load = (show, opts = {}) => {
    const v = validateShow(clone(show));
    if (opts.undoable) S.history.undo.push({ label: opts.label || "Show laden", json: snapshot() });
    else S.history.undo.length = 0;
    S.history.redo.length = 0;
    S.show = v;
    reindex();
    pruneProgrammer();
    S.transport.duration = v.audio.duration || S.transport.duration;
    S.emit("show:changed", { label: opts.label || "Show laden", scope: "all" });
    historyChanged(opts.label || "Show laden");
    if (opts.save !== false) scheduleSave();
    return S.show;
  };
  S.serialize = () => JSON.stringify(S.show);
  S.exportJSON = () => JSON.stringify(S.show, null, 1);
  S.importJSON = (str) => {
    try {
      const v = validateShow(JSON.parse(str));
      S.load(v, { undoable: true, label: "Import" });
      S.status(`Show „${v.name}“ importiert (${v.fixtures.length} Fixtures, ${v.cues.length} Cues)`, "ok");
      return true;
    } catch (e) {
      S.status(`Import fehlgeschlagen: ${e.message}`, "error");
      return false;
    }
  };
  S.saveLocal = () => {
    try {
      if (typeof localStorage === "undefined") return false;
      localStorage.setItem(STORAGE_KEY, S.serialize());
      S.emit("show:saved", { at: Date.now() });
      return true;
    } catch (e) {
      return false;
    }
  };
  // saved show → {show} | {stale, raw} (stock demo of an older version) | null
  function readLocal() {
    try {
      if (typeof localStorage === "undefined") return null;
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const o = JSON.parse(raw);
      if (!o || typeof o !== "object") return null;
      // a stale stock demo (older version, never edited) gives way to the current demo; an edited one is a user show.
      // `stock` is set by createDemoShow and cleared by the first edit; older saves without it: edited ≥ 60 s after creation
      const untouched = typeof o.stock === "boolean" ? o.stock : !(o.modified - o.created >= 60000);
      if (o.version !== SHOW_VERSION && o.name === DEMO_NAME && untouched) return { stale: true, raw };
      return { show: o };
    } catch (e) {
      return null;
    }
  }
  S.hasLocal = () => !!readLocal()?.show;
  S.loadLocal = () => {
    const r = readLocal();
    if (!r) return false;
    if (r.stale) {
      try { localStorage.setItem(`${STORAGE_KEY}.bak`, r.raw); } catch (e) { /* ignore */ }
      return false;
    }
    try {
      S.load(r.show, { label: "Gespeicherte Show", save: false }); // validateShow upgrades older versions
      return true;
    } catch (e) {
      return false;
    }
  };
  S.clearLocal = () => { try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ } };
  function scheduleSave() {
    if (!S.autosave || typeof setTimeout === "undefined" || typeof localStorage === "undefined") return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(S.saveLocal, 800);
  }

  /* ---- patch */
  S.nextFreeAddress = (universe, count, skipIds = []) => {
    const used = new Uint8Array(513);
    for (const f of S.show.fixtures) {
      if (f.universe !== universe || skipIds.includes(f.id)) continue;
      const n = getType(f.type)?.footprint || 1;
      for (let i = 0; i < n; i++) if (f.address + i <= 512) used[f.address + i] = 1;
    }
    for (let a = 1; a + count - 1 <= 512; a++) {
      let ok = true;
      for (let i = 0; i < count; i++) if (used[a + i]) { ok = false; a += i; break; }
      if (ok) return a;
    }
    return null;
  };
  S.addressConflicts = () => {
    const out = [], fs = S.show.fixtures;
    for (let i = 0; i < fs.length; i++) {
      const a = fs[i], na = getType(a.type)?.footprint || 1;
      if (a.address < 1 || a.address + na - 1 > 512) out.push({ a: a.id, b: null, universe: a.universe, reason: "range" });
      for (let j = i + 1; j < fs.length; j++) {
        const b = fs[j], nb = getType(b.type)?.footprint || 1;
        if (a.universe === b.universe && a.address < b.address + nb && b.address < a.address + na)
          out.push({ a: a.id, b: b.id, universe: a.universe, reason: "overlap" });
      }
    }
    return out;
  };
  S.addFixtures = (type, count = 1, opts = {}) => {
    const d = getType(type);
    if (!d) throw new Error(`Unbekannter Fixture-Typ ${type}`);
    return S.mutate(`${count}× ${d.name} hinzufügen`, (show) => {
      const added = [];
      let fid = opts.fid || Math.max(0, ...show.fixtures.map((f) => f.fid || 0)) + 1;
      const universe = opts.universe || 1;
      const spacing = opts.spacing ?? 1;
      const base = opts.pos || [0, 6, 0];
      for (let i = 0; i < count; i++) {
        while (show.fixtures.some((f) => f.fid === fid)) fid++;
        index = null;
        const address = (i === 0 && opts.address) || S.nextFreeAddress(universe, d.footprint) || 1;
        const f = {
          id: `f${fid}`, fid, type, name: `${opts.name || d.name} ${i + 1}`, universe, address,
          pos: [base[0] + (i - (count - 1) / 2) * spacing, base[1], base[2]],
          mount: opts.mount || (d.category === "mover" ? "hang" : "floor"), yaw: opts.yaw || 0,
          orient: { pan: 0, tilt: 0, ...(opts.orient || {}) },
        };
        while (show.fixtures.some((x) => x.id === f.id)) f.id += "b";
        show.fixtures.push(f);
        added.push(f);
        fid++;
      }
      if (opts.group) {
        const g = show.groups.find((x) => x.id === opts.group);
        if (g) g.fixtures.push(...added.map((f) => f.id));
      }
      return added;
    }, { scope: "patch" });
  };
  S.updateFixture = (id, patch, opts = {}) => S.mutate(opts.label || "Fixture ändern", (show) => {
    const f = show.fixtures.find((x) => x.id === id);
    if (f) Object.assign(f, clone(patch));
    return f;
  }, { scope: "patch", coalesce: opts.coalesce });
  S.removeFixtures = (ids) => {
    const del = new Set(ids);
    if (!del.size) return;
    S.mutate(`${del.size} Fixture(s) löschen`, (show) => {
      show.fixtures = show.fixtures.filter((f) => !del.has(f.id));
      for (const g of show.groups) g.fixtures = g.fixtures.filter((id) => !del.has(id));
      const scrub = (holder) => {
        for (const id of del) delete holder.values?.[id];
        for (const e of holder.effects || []) e.targets = e.targets.filter((t) => !del.has(t));
      };
      show.cues.forEach(scrub);
      show.executors.forEach(scrub);
      for (const h of show.hits || []) h.targets = h.targets.filter((t) => !del.has(t));
      show.hits = (show.hits || []).filter((h) => h.targets.length);
      for (const p of show.presets) if (p.perFixture) for (const id of del) delete p.perFixture[id];
    }, { scope: "patch" });
    pruneProgrammer();
  };

  /* ---- groups */
  S.addGroup = (name, ids = S.programmer.selection, color = "#3ec5ff") => S.mutate("Gruppe anlegen", (show) => {
    const g = { id: uid("g-"), name: name || `Gruppe ${show.groups.length + 1}`, fixtures: [...ids], color };
    show.groups.push(g);
    return g;
  }, { scope: "groups" });
  S.updateGroup = (id, patch) => S.mutate("Gruppe ändern", (show) => {
    const g = show.groups.find((x) => x.id === id);
    if (g) Object.assign(g, clone(patch));
    return g;
  }, { scope: "groups" });
  S.removeGroup = (id) => {
    const g = S.group(id);
    if (!g) return;
    S.mutate(`Gruppe „${g.name}“ löschen`, (show) => {
      // keep cue content: expand group entries into fixture entries (existing fixture entries win)
      for (const holder of [...show.cues, ...show.executors]) {
        const gv = holder.values?.[id];
        if (gv) {
          for (const fid of g.fixtures) holder.values[fid] = { ...gv, ...(holder.values[fid] || {}) };
          delete holder.values[id];
        }
        for (const e of holder.effects || []) e.targets = e.targets.flatMap((t) => (t === id ? g.fixtures : [t]));
      }
      for (const hh of show.hits || []) hh.targets = hh.targets.flatMap((t) => (t === id ? g.fixtures : [t]));
      show.groups = show.groups.filter((x) => x.id !== id);
    }, { scope: "groups" });
  };

  /* ---- selection */
  S.select = (ids, mode = "set") => {
    const valid = ids.filter((id) => idx().f.has(id));
    let sel = S.programmer.selection;
    if (mode === "set") sel = [...new Set(valid)];
    else if (mode === "add") sel = [...new Set([...sel, ...valid])];
    else if (mode === "remove") sel = sel.filter((id) => !valid.includes(id));
    else if (mode === "toggle") {
      const allIn = valid.every((id) => sel.includes(id));
      sel = allIn ? sel.filter((id) => !valid.includes(id)) : [...new Set([...sel, ...valid])];
    }
    S.programmer.selection = sel;
    S.emit("selection:changed", { ids: sel });
    return sel;
  };
  S.selectGroup = (gid, mode = "set") => S.select(S.resolve([gid]), mode);
  S.selectAll = () => S.select(S.show.fixtures.map((f) => f.id));
  S.clearSelection = () => S.select([], "set");

  /* ---- programmer */
  const progChanged = (ids, attrs, effects = false) => S.emit("programmer:changed", { ids, attrs, effects });
  // value: number | (fixtureId, i, n, current) => number. Only applied to fixtures that have `attr`.
  S.setValue = (attr, value, ids = S.programmer.selection) => {
    const done = [];
    ids.forEach((id, i) => {
      const f = S.fixture(id);
      if (!f || !hasAttr(f.type, attr)) return;
      const cur = S.programmer.values[id]?.[attr];
      const v = typeof value === "function" ? value(id, i, ids.length, cur) : value;
      if (v === undefined || v === null || Number.isNaN(v)) return;
      const s = ATTRS[attr];
      (S.programmer.values[id] ||= {})[attr] = s ? clamp(s.discrete ? Math.round(v) : v, s.min, s.max) : v;
      done.push(id);
    });
    if (done.length) progChanged(done, [attr]);
    return done;
  };
  S.setValues = (attrs, ids = S.programmer.selection) => {
    const keys = Object.keys(attrs).filter((k) => ATTRS[k]);
    for (const id of ids) {
      const f = S.fixture(id);
      if (!f) continue;
      for (const k of keys) {
        if (!hasAttr(f.type, k)) continue;
        const s = ATTRS[k];
        (S.programmer.values[id] ||= {})[k] = clamp(s.discrete ? Math.round(attrs[k]) : attrs[k], s.min, s.max);
      }
    }
    progChanged(ids, keys);
  };
  S.releaseValues = (attrs, ids = S.programmer.selection) => {
    for (const id of ids) {
      const v = S.programmer.values[id];
      if (!v) continue;
      for (const k of attrs) delete v[k];
      if (!Object.keys(v).length) delete S.programmer.values[id];
    }
    progChanged(ids, attrs);
  };
  S.clearProgrammer = (opts = {}) => {
    S.programmer.values = {};
    S.programmer.effects = [];
    if (!opts.keepSelection) S.programmer.selection = [];
    progChanged([], [], true);
    if (!opts.keepSelection) S.emit("selection:changed", { ids: [] });
  };
  S.programmerEmpty = () => !Object.keys(S.programmer.values).length && !S.programmer.effects.length;
  S.addEffect = (spec = {}) => {
    const e = makeEffect({ ...spec, targets: spec.targets || [...S.programmer.selection] });
    S.programmer.effects.push(e);
    progChanged(S.resolve(e.targets), [], true);
    return e;
  };
  S.updateEffect = (id, patch) => {
    const e = S.programmer.effects.find((x) => x.id === id);
    if (!e) return null;
    const prevForm = e.form;
    Object.assign(e, clone(patch));
    if (patch.type && !EFFECT_FORMS[e.type].includes(e.form)) e.form = EFFECT_FORMS[e.type][0];
    if (patch.type || patch.form || patch.attr) {
      // refill type/form defaults (attr range, pattern, onset params); explicit patch values win
      const spec = { ...e };
      if (e.form !== prevForm) {
        // the previous form's own params do not carry over (a chase must not inherit a pattern's unison phase)
        for (const k of FORM_KEYS) if (patch[k] === undefined) delete spec[k];
        if (prevForm === "onsetStep" && patch.size === undefined) delete spec.size;
        if (PHASELESS.has(prevForm) && !PHASELESS.has(e.form) && patch.phase === undefined) spec.phase = EFFECT_DEFAULTS.phase;
        for (const k of [...FORM_KEYS, "size"]) delete e[k];
      }
      if (patch.type === "attr" || patch.attr) { if (patch.low === undefined) delete spec.low; if (patch.high === undefined) delete spec.high; }
      if (patch.type === "attr" && patch.mode === undefined) delete spec.mode;
      if ((patch.form === "pattern" || patch.form === "onsetStep") && patch.phase === undefined) delete spec.phase;
      Object.assign(e, makeEffect(spec), { id: e.id });
    }
    progChanged(S.resolve(e.targets), [], true);
    return e;
  };
  S.removeEffect = (id) => {
    S.programmer.effects = S.programmer.effects.filter((x) => x.id !== id);
    progChanged([], [], true);
  };
  function pruneProgrammer() {
    const ok = (id) => idx().f.has(id);
    S.programmer.selection = S.programmer.selection.filter(ok);
    for (const id of Object.keys(S.programmer.values)) if (!ok(id)) delete S.programmer.values[id];
  }

  /* ---- presets */
  S.presetValues = (preset, fixtureId) => {
    const f = S.fixture(fixtureId);
    if (!f || !preset) return null;
    let v = null;
    if (preset.perFixture && preset.perFixture[fixtureId]) v = preset.perFixture[fixtureId];
    else if (preset.aim) v = getType(f.type)?.caps.pantilt ? aimAt(f, preset.aim) : null;
    else if (preset.attrs) v = preset.attrs;
    if (!v) return null;
    const out = {};
    for (const k in v) if (hasAttr(f.type, k)) out[k] = v[k];
    return Object.keys(out).length ? out : null;
  };
  S.applyPreset = (presetId, ids = S.programmer.selection) => {
    const p = S.preset(presetId);
    if (!p) return 0;
    let n = 0;
    for (const id of ids) {
      const v = S.presetValues(p, id);
      if (!v) continue;
      Object.assign((S.programmer.values[id] ||= {}), v);
      n++;
    }
    progChanged(ids, Object.keys(p.attrs || { pan: 1, tilt: 1 }));
    return n;
  };
  const KIND_ATTRS = {
    color: ["r", "g", "b", "w"], position: ["pan", "tilt"], dim: ["dim"],
    beam: ["zoom", "iris", "focus", "frost", "gobo", "goboSpin", "prism", "prismRot"], all: ATTR_KEYS,
  };
  S.storePreset = (kind, name, ids = S.programmer.selection) => {
    const keys = KIND_ATTRS[kind] || ATTR_KEYS;
    const per = {};
    for (const id of ids) {
      const v = S.programmer.values[id];
      if (!v) continue;
      const o = {};
      for (const k of keys) if (v[k] !== undefined) o[k] = v[k];
      if (Object.keys(o).length) per[id] = o;
    }
    const list = Object.values(per);
    if (!list.length) { S.status("Programmer enthält keine passenden Werte", "warn"); return null; }
    const same = list.every((o) => JSON.stringify(o) === JSON.stringify(list[0]));
    return S.mutate("Preset speichern", (show) => {
      const p = { id: uid(`p-${kind}-`), kind, name: name || `${kind} ${show.presets.length + 1}`, color: null };
      if (same && kind !== "position") p.attrs = list[0]; else p.perFixture = per;
      if (kind === "color") {
        const c = list[0];
        p.color = `rgb(${Math.round((c.r ?? 1) * 255)},${Math.round((c.g ?? 1) * 255)},${Math.round((c.b ?? 1) * 255)})`;
      }
      show.presets.push(p);
      return p;
    }, { scope: "presets" });
  };
  S.removePreset = (id) => S.mutate("Preset löschen", (show) => { show.presets = show.presets.filter((p) => p.id !== id); }, { scope: "presets" });

  /* ---- cues */
  S.cueIndexAt = (t) => {
    const c = S.show.cues;
    let lo = 0, hi = c.length - 1, r = -1;
    while (lo <= hi) {
      const m = (lo + hi) >> 1;
      if (c[m].time <= t + 1e-6) { r = m; lo = m + 1; } else hi = m - 1;
    }
    return r;
  };
  S.makeCue = (spec = {}) => ({
    id: uid("c"), name: spec.name || `Cue ${S.show.cues.length + 1}`, time: 0, fade: S.show.settings.fadeDefault ?? 1, delay: 0,
    color: null, block: false, values: {}, effects: [], kill: [], note: "", ...clone(spec),
  });
  S.addCue = (spec = {}) => S.mutate("Cue anlegen", (show) => {
    const c = S.makeCue(spec);
    show.cues.push(c);
    return c;
  }, { scope: "cues" });
  S.updateCue = (id, patch, opts = {}) => S.mutate(opts.label || "Cue ändern", (show) => {
    const c = show.cues.find((x) => x.id === id);
    if (c) Object.assign(c, clone(patch));
    // optional keys cleared in the editor ("–") are dropped, not stored as null
    if (c) for (const k of ["camera", "performer"]) if (k in c && !c[k]) delete c[k];
    return c;
  }, { scope: "cues", coalesce: opts.coalesce });
  S.removeCue = (id) => S.mutate("Cue löschen", (show) => {
    show.cues = show.cues.filter((c) => c.id !== id);
    if (S.ui.cueId === id) S.ui.cueId = null;
  }, { scope: "cues" });
  S.duplicateCue = (id, time) => {
    const src = S.cue(id);
    if (!src) return null;
    return S.addCue({ ...clone(src), id: undefined, name: `${src.name} (Kopie)`, time: time ?? src.time + 1,
      effects: src.effects.map((e) => ({ ...e, id: uid("e") })) });
  };
  // Programmer → cue. mode: "auto" (merge into a cue at the same time, else new) | "new" | "merge" | "replace"
  S.storeCue = (opts = {}) => {
    if (S.programmerEmpty()) { S.status("Programmer ist leer – nichts zu speichern", "warn"); return null; }
    const time = Math.max(0, opts.time ?? S.transport.t);
    const mode = opts.mode || "auto";
    let target = opts.cueId ? S.cue(opts.cueId) : null;
    if (!target && (mode === "auto" || mode === "merge")) target = S.show.cues.find((c) => Math.abs(c.time - time) < 0.03) || null;
    const values = clone(S.programmer.values);
    const effects = clone(S.programmer.effects);
    const cue = S.mutate(target ? "Cue aktualisieren" : "Cue speichern", (show) => {
      if (target && mode !== "new") {
        const c = show.cues.find((x) => x.id === target.id);
        if (mode === "replace") { c.values = values; c.effects = effects; }
        else {
          for (const id in values) c.values[id] = { ...(c.values[id] || {}), ...values[id] };
          for (const e of effects) {
            const i = c.effects.findIndex((x) => x.id === e.id);
            if (i >= 0) c.effects[i] = e; else c.effects.push(e);
          }
        }
        if (opts.name) c.name = opts.name;
        return c;
      }
      const c = S.makeCue({ name: opts.name, time, fade: opts.fade, delay: opts.delay, values, effects });
      if (opts.fade === undefined) c.fade = show.settings.fadeDefault ?? 1;
      if (opts.delay === undefined) c.delay = 0;
      show.cues.push(c);
      return c;
    }, { scope: "cues" });
    S.status(`${cue.name} gespeichert (${Object.keys(values).length} Fixtures, ${effects.length} Effekte)`, "ok");
    if (!opts.keep) S.clearProgrammer({ keepSelection: true });
    S.setUI("cueId", cue.id);
    return cue;
  };

  /* ---- hits (one-shot flashes, show.hits) */
  S.setHits = (hits, label = "Hits setzen") => S.mutate(label, (show) => {
    show.hits = (hits || []).map(makeHit).filter(Boolean).sort((a, b) => a.t - b.t);
    return show.hits;
  }, { scope: "cues" });
  S.addHits = (hits, label = "Hits hinzufügen") => S.mutate(label, (show) => {
    const add = (Array.isArray(hits) ? hits : [hits]).map(makeHit).filter(Boolean);
    show.hits = [...(show.hits || []), ...add].sort((a, b) => a.t - b.t);
    return add;
  }, { scope: "cues" });
  S.removeHits = (t0, t1, label = "Hits löschen") => S.mutate(label, (show) => {
    show.hits = (show.hits || []).filter((h) => h.t < t0 || h.t > t1);
  }, { scope: "cues" });

  /* ---- markers */
  S.setMarkers = (markers) => S.mutate("Marker setzen", (show) => { show.markers = clone(markers).sort((a, b) => a.time - b.time); }, { scope: "cues" });

  /* ---- live: executors, master, tap */
  S.setExecutor = (id, active) => {
    const x = S.executor(id);
    if (!x) return;
    const prev = S.live.executors[id];
    if (prev && prev.active === active) return;
    S.live.executors[id] = { active, t: now() };
    S.emit("live:changed", { key: "executor", id, active });
  };
  S.toggleExecutor = (id) => S.setExecutor(id, !S.live.executors[id]?.active);
  S.setGrandmaster = (v) => { S.live.grandmaster = clamp(v); S.emit("live:changed", { key: "grandmaster", value: S.live.grandmaster }); };
  S.setBlackout = (b) => { S.live.blackout = !!b; S.emit("live:changed", { key: "blackout", value: S.live.blackout }); };
  S.setTap = (bpm, anchor) => {
    S.live.tap = bpm ? { bpm, anchor } : null;
    S.emit("live:changed", { key: "tap", value: S.live.tap });
  };

  /* ---- transport (written by audio.js; per-frame time goes to S.transport.t without an event) */
  S.setTransport = (patch) => {
    Object.assign(S.transport, patch);
    S.emit("transport:changed", { ...S.transport });
  };

  /* ---- ui */
  // o.auto: set by the app itself (not a user pick), passed on in the event
  S.setUI = (key, value, o = {}) => {
    if (S.ui[key] === value) return;
    S.ui[key] = value;
    S.emit("ui:changed", { key, value, auto: !!o.auto });
  };

  /* ---- beat grid */
  // Fractional beat number at time t (beat 0 = first grid beat). Uses tap tempo if set, else the grid, else show bpm.
  S.beatAt = (t) => {
    const tap = S.live.tap, a = S.show.audio, g = a.beats;
    if (tap) return ((t - tap.anchor) * tap.bpm) / 60;
    if (!g || g.length < 2) return ((t - (a.offset || 0)) * (a.bpm || 120)) / 60;
    if (t <= g[0]) return (t - g[0]) / (g[1] - g[0]);
    const n = g.length;
    if (t >= g[n - 1]) return n - 1 + (t - g[n - 1]) / (g[n - 1] - g[n - 2]);
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (g[m] <= t) lo = m; else hi = m; }
    return lo + (t - g[lo]) / (g[lo + 1] - g[lo]);
  };
  S.timeAtBeat = (b) => {
    const tap = S.live.tap, a = S.show.audio, g = a.beats;
    if (tap) return tap.anchor + (b * 60) / tap.bpm;
    if (!g || g.length < 2) return (a.offset || 0) + (b * 60) / (a.bpm || 120);
    const n = g.length;
    if (b <= 0) return g[0] + b * (g[1] - g[0]);
    if (b >= n - 1) return g[n - 1] + (b - (n - 1)) * (g[n - 1] - g[n - 2]);
    const i = Math.floor(b);
    return g[i] + (b - i) * (g[i + 1] - g[i]);
  };
  S.bpmAt = (t) => {
    if (S.live.tap) return S.live.tap.bpm;
    const g = S.show.audio.beats;
    if (!g || g.length < 2) return S.show.audio.bpm || 120;
    const i = Math.max(0, Math.min(g.length - 2, Math.floor(S.beatAt(t))));
    const lo = Math.max(0, i - 2), hi = Math.min(g.length - 1, i + 3);
    return (60 * (hi - lo)) / (g[hi] - g[lo]);
  };
  // { bar (1-based), beat (1-based in bar), beats (fractional total) }
  S.barAt = (t) => {
    const bpb = S.show.audio.beatsPerBar || 4;
    const beats = S.beatAt(t) - (S.show.audio.downbeat || 0);
    const whole = Math.floor(beats + 1e-6);
    return { bar: Math.floor(whole / bpb) + 1, beat: (((whole % bpb) + bpb) % bpb) + 1, beats };
  };
  S.snapTime = (t, div = 1) => {
    const b = S.beatAt(t);
    return S.timeAtBeat(Math.round(b * div) / div);
  };

  reindex();
  return S;
}
