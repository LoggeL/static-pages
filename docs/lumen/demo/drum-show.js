// Demo show "Drum Show": builds cues + markers from the audio analysis (beat grid, segments, onsets, energy).
// Cue names are structural only.

import { createShow, applyAnalysis, createState, makeEffect } from "../core/state.js";
import { SWATCHES } from "../core/fixtures.js";

// colour dramaturgy: warm drums in the verses, magenta/cyan refrains, red/white peak, cold bridge, everything in the finale
const COL = Object.fromEntries(SWATCHES.map((s) => [s.name, { r: s.rgbw[0], g: s.rgbw[1], b: s.rgbw[2], w: s.rgbw[3] }]));
const RGB = (n) => [COL[n].r, COL[n].g, COL[n].b];
const LOOK = {
  intro: ["Blau", "UV"],
  strophe1: ["Tiefrot", "Orange"],
  break: ["Weiß", "Hellblau"],
  refrain1: ["Magenta", "Cyan"],
  strophe2: ["Cyan", "Orange"],
  refrain2: ["Rot", "Weiß"],
  bridge: ["Blau", "Lavendel"],
  rebuild: ["Blau", "Cyan"],
  finale: ["Rot", "Gelb", "Weiß", "Magenta"],
};

// song structure (s) — snapped to the analysis segments when one is close
const SECTIONS = [
  [0, "Intro", "#3a5bd9"], [11.7, "Strophe 1", "#ff6a3d"], [35.25, "Break", "#8b95a3"], [40.87, "Refrain 1", "#ff3fb4"],
  [64.39, "Mini-Break", "#8b95a3"], [67.2, "Strophe 2", "#ff9a3d"], [88, "Aufbau", "#ffcc4d"], [93.67, "Refrain 2", "#ff3f5e"],
  [117.19, "Bridge", "#5a7bff"], [120.02, "Bridge – Stille", "#3a4a8a"], [122.93, "Bridge – Licht", "#5a7bff"], [138.27, "Bridge – Ende", "#3a4a8a"],
  [140.5, "Neuaufbau", "#3ec5ff"], [152, "Finale", "#ffb000"], [200.48, "Ausklang", "#8b95a3"],
];

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

export function createDemoShow(an) {
  const show = applyAnalysis(createShow({ name: "Drum Show – Demo" }), an);
  show.audio.downbeat = an ? findDownbeat(an, show.audio.beatsPerBar) : 0;
  const st = createState(show);
  st.autosave = false;
  st.analysis = an || null;
  const S = st.show;

  /* ---- time helpers */
  const snap = (t) => +st.snapTime(t).toFixed(3);
  const bars = (t, n) => +st.timeAtBeat(Math.round(st.beatAt(t)) + n * (S.audio.beatsPerBar || 4)).toFixed(3);
  const beats = (t, n) => +st.timeAtBeat(Math.round(st.beatAt(t)) + n).toFixed(3);
  const segs = an?.segments || [];
  // detected segment boundaries keep their beat; hand-placed ones land on the nearest downbeat
  const bpb = S.audio.beatsPerBar || 4, db = S.audio.downbeat || 0;
  const snapBar = (t) => +st.timeAtBeat(Math.max(0, Math.round((st.beatAt(t) - db) / bpb) * bpb + db)).toFixed(3);
  const sec = SECTIONS.map(([t, name, color]) => {
    const s = segs.find((x) => Math.abs(x - t) < 1);
    return { time: s !== undefined ? snap(s) : snapBar(t), name, color };
  });
  const T = Object.fromEntries(sec.map((s) => [s.name, s.time]));

  /* ---- value helpers */
  const preset = (name, kind) => S.presets.find((p) => p.name === name && (!kind || p.kind === kind));
  const pos = (name, targets) => {
    const p = preset(name, "position"), out = {};
    for (const id of st.resolve(targets)) { const v = st.presetValues(p, id); if (v) out[id] = v; }
    return out;
  };
  const beam = (name) => ({ ...preset(name, "beam").attrs });
  const col = (n) => ({ ...COL[n] });
  const L = (...parts) => {
    const out = {};
    for (const p of parts) for (const id in p) out[id] = { ...(out[id] || {}), ...p[id] };
    return out;
  };
  const G = (id, ...attrs) => ({ [id]: Object.assign({}, ...attrs) });
  const haze = (v = 0.55) => G("g-haze", { dim: v });

  /* ---- effect helpers */
  const fxOnset = (targets, low = 0.1, high = 1, mode = "abs") => ({ type: "dim", form: "onset", targets, low, high, mode, name: "Drum-Onsets" });
  const fxEnv = (targets, band = "low", low = 0.25) => ({ type: "dim", form: "env", band, targets, low, high: 1, mode: "mul", name: "Hüllkurve" });
  const fxChase = (targets, speed = 0.5, duty = 0.35, wings = 0) => ({ type: "dim", form: "chase", targets, speed, duty, wings, phase: 360, low: 0.15, high: 1, mode: "mul", name: "Dimmer-Chase" });
  const fxSine = (targets, hz, low = 0.4) => ({ type: "dim", form: "sine", sync: "free", speed: hz, targets, low, high: 1, mode: "mul", phase: 360, name: "Atmen" });
  const fxRamp = (targets, t0, t1) => {
    const speed = 1 / Math.max(0.5, t1 - t0);
    return { type: "dim", form: "ramp", sync: "free", speed, offset: -((t0 * speed) % 1) * 360, phase: 0, targets, low: 0, high: 1, mode: "mul", name: "Ramp-up" };
  };
  const fxFan = (targets, size = 22, speed = 0.125) => ({ type: "position", form: "fan", targets, size, speed, wings: 0, name: "Fächer" });
  const fxMove = (targets, form, size, speed, phase = 360, wings = 0) => ({ type: "position", form, targets, size, speed, phase, wings, name: "Bewegung" });
  const fxColor = (targets, names, speed = 0.25, phase = 360) => ({ type: "color", form: "chase", targets, colors: names.map(RGB), speed, phase, name: "Farb-Chase" });
  const fxRainbow = (targets, speed = 0.0625) => ({ type: "color", form: "rainbow", targets, speed, phase: 360, sat: 1, name: "Regenbogen" });
  const fxPixel = (form, names, speed = 0.5, size = 0.18, phase = 360) =>
    ({ type: "pixel", form, targets: ["g-bars"], colors: names.map(RGB), speed, size, phase, name: "Pixel" });

  /* ---- cue builder */
  const cues = [];
  const cue = (name, time, o = {}) => {
    const n = cues.length + 1;
    cues.push({
      id: `c${String(n).padStart(3, "0")}`, name, time: snap(time), fade: +(o.fade ?? 1).toFixed(2), delay: o.delay ?? 0,
      color: o.color ?? null, block: !!o.block, values: o.values || {}, kill: o.kill || [], note: o.note || "",
      effects: (o.effects || []).map((e, i) => ({ ...makeEffect(e), id: `e${n}-${i}` })),
    });
  };
  const HIT = "#ffd27a";
  const hit = (name, t, values, effects, extra = {}) => {
    cue(name, t, { block: true, fade: 0, color: HIT, values: L(values, G("g-blinder", { dim: 1 })), effects, ...extra });
    cue(`${name} – Nachklang`, beats(t, 2), { fade: 1.4, values: G("g-blinder", { dim: 0 }) });
  };

  /* ================================================================ Intro */
  const I = LOOK.intro;
  const introFx = [fxSine(["g-wash"], 0.12, 0.45), fxPixel("wave", [I[0]], 0.08, 0.3, 180)];
  cue("Intro", 0, {
    block: true, fade: 3,
    values: L(haze(0.6), G("g-wash", col(I[0]), { dim: 0.28, zoom: 40 }), pos("Bühne Mitte", ["g-wash"]),
      G("g-bars", col(I[0]), { dim: 0.35 }), G("g-riser", col(I[1]), { dim: 0.12 }), G("g-par", col(I[0]), { dim: 0.08 })),
    effects: introFx,
  });
  cue("Intro – Drums", bars(T.Intro, 4), {
    fade: 3,
    values: L(G("g-spot", col("Lavendel"), beam("Gobo Speichen"), { dim: 0.45, zoom: 14 }),
      pos("Drums links", ["g-spot-l"]), pos("Drums rechts", ["g-spot-r"])),
  });
  const introRamp = bars(T["Strophe 1"], -2);
  cue("Intro – Spannung", introRamp, {
    fade: 0.5,
    values: L(G("g-beam", col("Weiß"), beam("Offen"), { dim: 0.7 }), pos("Senkrecht", ["g-beam"])),
    effects: [...introFx, fxRamp(["g-beam"], introRamp, T["Strophe 1"])],
  });

  /* ================================================================ Strophe 1 */
  const verse = (P, key, extra = {}) => L(haze(0.55),
    G("g-wash", col(P[0]), { dim: 0.7, zoom: 30 }), pos("Bühne Mitte", ["g-wash"]),
    G("g-spot", col(P[1]), beam("Gobo Punkte"), { dim: 0.9, zoom: 12 }), pos("Drums links", ["g-spot-l"]), pos("Drums rechts", ["g-spot-r"]),
    G("g-riser", col(P[1]), { dim: 1 }), G("g-par", col(P[0]), { dim: 0.5 }), G("g-bars", { dim: 1 }),
    G("g-floor", col(P[0]), { dim: 0.8 }), pos(key, ["g-floor"]), extra);
  const S1 = LOOK.strophe1;
  const s1Fx = [fxOnset(["g-riser"]), fxEnv(["g-par"]), fxPixel("chase", [S1[1], S1[0]], 0.5, 0.2)];
  hit("Strophe 1", T["Strophe 1"], verse(S1, "Fächer hoch"), s1Fx);
  cue("Strophe 1 – B", bars(T["Strophe 1"], 8), {
    fade: 2,
    values: L(G("g-wash", col(S1[1])), G("g-beam", col(S1[0]), beam("Offen"), { dim: 0.6 }), pos("Kreuz", ["g-beam"])),
    effects: [...s1Fx, fxChase(["g-beam"], 0.5, 0.35)],
  });
  cue("Strophe 1 – C", bars(T["Strophe 1"], 12), {
    fade: 1,
    values: L(G("g-wash", { dim: 0.85 }), G("g-spot", beam("Gobo Speichen")), pos("Fächer hoch", ["g-beam"])),
    effects: [...s1Fx, fxChase(["g-beam"], 0.5, 0.35, 2), fxMove(["g-beam"], "tilt", 10, 0.125)],
  });

  /* ================================================================ Break */
  const B = LOOK.break;
  cue("Break", T.Break, {
    block: true, fade: 0.4,
    values: L(haze(0.7), G("g-beam", col(B[0]), beam("Offen"), { dim: 0.45 }), pos("Senkrecht", ["g-beam"]),
      G("g-riser", col(B[1]), { dim: 0.6 })),
    effects: [fxSine(["g-beam"], 0.25, 0.3), fxOnset(["g-riser"], 0, 0.7)],
  });
  const brRamp = bars(T["Refrain 1"], -2);
  cue("Break – Aufbau", brRamp, {
    fade: T["Refrain 1"] - brRamp - 0.1,
    values: L(G("g-strobe", { dim: 0.55, strobe: 12 }), G("g-beam", { dim: 1 }), G("g-bars", col("Weiß"), { dim: 0.6 })),
    effects: [fxRamp(["g-beam", "g-bars"], brRamp, T["Refrain 1"]), fxOnset(["g-riser"], 0, 0.8)],
  });

  /* ================================================================ Refrain 1 */
  const chorus = (P, extra = {}) => L(haze(0.6),
    G("g-beam", col(P[0]), beam("Offen"), { dim: 1 }), pos("Fächer hoch", ["g-beam"]),
    G("g-floor", col(P[1]), { dim: 1 }), pos("Fächer hoch", ["g-floor"]),
    G("g-spot", col(P[1]), beam("Gobo Splitter"), { dim: 0.85, zoom: 16 }), pos("Fächer Publikum", ["g-spot"]),
    G("g-wash", col(P[0]), { dim: 0.85, zoom: 22 }), pos("Bühne Mitte", ["g-wash"]),
    G("g-par", col(P[1]), { dim: 0.6 }), G("g-riser", col(P[0]), { dim: 1 }), G("g-bars", { dim: 1 }), extra);
  const R1 = LOOK.refrain1;
  const r1Fx = [fxFan(["g-beam"], 22), fxChase(["g-beam"], 0.5, 0.5, 2), fxMove(["g-spot"], "circle", 10, 0.125, 180),
    fxColor(["g-wash", "g-par"], R1, 0.25), fxPixel("chase", [R1[1], R1[0]], 1, 0.15, 720), fxOnset(["g-riser"])];
  hit("Refrain 1", T["Refrain 1"], chorus(R1), r1Fx);
  cue("Refrain 1 – B", bars(T["Refrain 1"], 4), { fade: 1.5, values: L(G("g-spot", beam("Gobo Speichen")), pos("Fächer Publikum", ["g-floor"])) });
  const r1Drop = bars(T["Refrain 1"], 8);
  const r1DropFx = [fxFan(["g-beam"], 30, 0.25), fxChase(["g-beam"], 1, 0.4, 2), fxMove(["g-spot"], "circle", 14, 0.25, 180),
    fxColor(["g-wash", "g-par"], R1, 0.5), fxPixel("chase", [R1[0], R1[1]], 1, 0.15, 720), fxOnset(["g-riser", "g-strobe"])];
  cue("Refrain 1 – Drop", r1Drop, {
    fade: 0, color: HIT,
    values: L(G("g-beam", beam("Prisma 3")), G("g-spot", col("Weiß")), G("g-strobe", { dim: 1, strobe: 0 })),
    effects: r1DropFx,
  });
  cue("Refrain 1 – Drop B", bars(r1Drop, 4), {
    fade: 0.6,
    values: L(G("g-beam", col(R1[1]), beam("Offen")), pos("Fächer Publikum", ["g-beam"]), G("g-floor", col(R1[0]))),
  });

  /* ================================================================ Mini-Break */
  cue("Mini-Break", T["Mini-Break"], {
    block: true, fade: 0,
    values: L(haze(0.6), G("g-beam", col("Weiß"), beam("Offen"), { dim: 1 }), pos("Senkrecht", ["g-beam"])),
    effects: [fxRamp(["g-beam"], T["Mini-Break"], T["Strophe 2"])],
  });

  /* ================================================================ Strophe 2 */
  const S2 = LOOK.strophe2;
  const s2Fx = [fxOnset(["g-riser"]), fxEnv(["g-par"]), fxPixel("chase", [S2[0], "Blau"], 0.5, 0.2),
    fxMove(["g-beam"], "wave", 14, 0.25, 360)];
  hit("Strophe 2", T["Strophe 2"], verse(S2, "Fächer Publikum",
    L(G("g-beam", col("Blau"), beam("Offen"), { dim: 0.5 }), pos("Kreuz", ["g-beam"]), G("g-spot", beam("Gobo Speichen")))), s2Fx);
  cue("Strophe 2 – B", bars(T["Strophe 2"], 8), {
    fade: 2,
    values: L(G("g-spot", col("Weiß"), beam("Gobo Punkte")), pos("Raster Boden", ["g-spot"]), G("g-wash", col("Blau"))),
    effects: [...s2Fx, fxChase(["g-beam"], 0.5, 0.35)],
  });
  cue("Strophe 2 – C", bars(T["Strophe 2"], 12), {
    fade: 1,
    values: L(G("g-spot", col(S2[1])), pos("Drums links", ["g-spot-l"]), pos("Drums rechts", ["g-spot-r"]), G("g-wash", col(S2[0]), { dim: 0.85 })),
  });

  /* ================================================================ Aufbau */
  const ab = T.Aufbau, abStrobe = bars(T["Refrain 2"], -2);
  cue("Aufbau", ab, {
    block: true, fade: 1,
    values: L(haze(0.65), G("g-beam", col("Weiß"), beam("Eng"), { dim: 0.8 }), pos("Senkrecht", ["g-beam"]),
      G("g-spot", col("Weiß"), beam("Frost"), { dim: 0.6 }), pos("Keys/Mikro", ["g-spot"]),
      G("g-riser", col("Rot"), { dim: 1 }), G("g-bars", { dim: 1 })),
    effects: [fxRamp(["g-beam"], ab, T["Refrain 2"]), fxOnset(["g-riser"]), fxPixel("fill", ["Weiß"], 0.25)],
  });
  cue("Aufbau – Strobe", abStrobe, {
    fade: T["Refrain 2"] - abStrobe - 0.1,
    values: L(G("g-strobe", { dim: 0.6, strobe: 16 }), G("g-blinder", { dim: 0.35 })),
  });

  /* ================================================================ Refrain 2 (Peak) */
  const R2 = LOOK.refrain2;
  const r2Fx = [fxFan(["g-beam"], 26, 0.25), fxChase(["g-beam"], 1, 0.4, 2), fxMove(["g-spot"], "circle", 12, 0.25, 180),
    fxColor(["g-wash", "g-par"], [R2[0], "Pink"], 0.5), fxPixel("chase", [R2[1], R2[0]], 1, 0.12, 720), fxOnset(["g-riser", "g-strobe"])];
  hit("Refrain 2", T["Refrain 2"], chorus(R2, G("g-strobe", { dim: 1 })), r2Fx);
  cue("Refrain 2 – B", bars(T["Refrain 2"], 4), {
    fade: 0.8,
    values: L(G("g-beam", col(R2[1]), beam("Prisma linear")), G("g-spot", col(R2[0]), beam("Gobo Splitter")), G("g-wash", col("Magenta"))),
    effects: [fxMove(["g-beam"], "circle", 10, 0.5, 360, 2), ...r2Fx.slice(1)],
  });
  const r2Drop = bars(T["Refrain 2"], 8);
  cue("Refrain 2 – Drop", r2Drop, {
    fade: 0, color: HIT,
    values: L(G("g-beam", col(R2[1]), beam("Offen")), pos("Fächer Publikum", ["g-beam"]), G("g-spot", col("Weiß"))),
    effects: [fxFan(["g-beam"], 34, 0.25), fxChase(["g-beam"], 1, 0.3, 2), fxMove(["g-spot"], "eight", 14, 0.25, 180),
      fxRainbow(["g-wash", "g-par"], 0.125), fxPixel("rainbow", [], 0.25, 0.2, 720), fxOnset(["g-riser", "g-strobe"])],
  });
  cue("Refrain 2 – Drop B", bars(r2Drop, 4), {
    fade: 0.6,
    values: L(G("g-beam", col(R2[0])), pos("Fächer hoch", ["g-beam"]), G("g-spot", col(R2[0])), pos("Kreuz", ["g-floor"])),
  });

  /* ================================================================ Bridge (cold, slow, almost dark) */
  const BR = LOOK.bridge;
  cue("Bridge", T.Bridge, {
    block: true, fade: 2.5,
    values: L(haze(0.75), G("g-wash", col(BR[0]), { dim: 0.2, zoom: 45 }), pos("Bühne Mitte", ["g-wash"]),
      G("g-spot", col(BR[1]), beam("Frost"), { dim: 0.35 }), pos("Keys/Mikro", ["g-spot"]), G("g-bars", col(BR[0]), { dim: 0.15 })),
    effects: [fxSine(["g-wash"], 0.08, 0.5), fxPixel("wave", [BR[0]], 0.05, 0.3, 180)],
  });
  cue("Bridge – Stille", T["Bridge – Stille"], {
    fade: 3,
    values: L(G("g-wash", { dim: 0.06 }), G("g-spot", { dim: 0 }), G("f204", { dim: 0.22 }), G("f205", { dim: 0.22 }), G("g-bars", { dim: 0.04 })),
  });
  cue("Bridge – Licht", T["Bridge – Licht"], {
    fade: 4,
    values: L(G("g-spot", col("Hellblau"), { dim: 0.28 }), G("g-beam", col(BR[0]), beam("Offen"), { dim: 0.18 }), pos("Senkrecht", ["g-beam"])),
    effects: [fxSine(["g-wash"], 0.08, 0.5), fxPixel("wave", [BR[0]], 0.05, 0.3, 180), fxMove(["g-beam"], "tilt", 9, 0.05, 360)],
  });
  cue("Bridge – Tief", bars(T["Bridge – Licht"], 5), {
    fade: 4, values: L(G("g-wash", col("UV"), { dim: 0.14 }), G("g-spot", col(BR[1]), { dim: 0.2 }), G("g-beam", { dim: 0.1 })),
  });
  cue("Bridge – Ende", T["Bridge – Ende"], {
    fade: 1.5, values: L(G("g-wash", { dim: 0 }), G("g-beam", { dim: 0 }), G("g-bars", { dim: 0 }), G("g-spot", { dim: 0.12 })),
  });

  /* ================================================================ Neuaufbau (layer by layer) */
  const RB = LOOK.rebuild, nb = T.Neuaufbau, nbRamp = bars(T.Finale, -2);
  const nbFx = [fxOnset(["g-riser"]), fxPixel("chase", [RB[0]], 0.25, 0.25)];
  cue("Neuaufbau", nb, {
    block: true, fade: 1,
    values: L(haze(0.6), G("g-beam", col(RB[0]), beam("Offen"), { dim: 0.35 }), pos("Senkrecht", ["g-beam"]),
      G("g-riser", col(RB[0]), { dim: 1 }), G("g-bars", { dim: 0.7 }), G("g-wash", col(RB[0]), { dim: 0.3, zoom: 30 }), pos("Bühne Mitte", ["g-wash"])),
    effects: nbFx,
  });
  cue("Neuaufbau – Drums", bars(nb, 2), {
    fade: 1.5,
    values: L(G("g-spot", col(RB[1]), beam("Gobo Punkte"), { dim: 0.6, zoom: 12 }), pos("Drums links", ["g-spot-l"]), pos("Drums rechts", ["g-spot-r"]),
      G("g-beam", col(RB[1]), { dim: 0.55 })),
  });
  cue("Neuaufbau – Fächer", bars(nb, 4), {
    fade: 1.5,
    values: L(G("g-beam", col("Weiß"), { dim: 0.75 }), pos("Fächer hoch", ["g-beam"]), G("g-wash", col(RB[1]), { dim: 0.5 }), G("g-bars", { dim: 1 })),
    effects: [fxOnset(["g-riser"]), fxPixel("chase", [RB[1], RB[0]], 0.5, 0.2), fxChase(["g-beam"], 0.5, 0.5)],
  });
  cue("Neuaufbau – Ramp", nbRamp, {
    fade: T.Finale - nbRamp - 0.1,
    values: L(G("g-strobe", { dim: 0.55, strobe: 18 }), G("g-blinder", { dim: 0.4 })),
    effects: [fxOnset(["g-riser"]), fxPixel("chase", [RB[1], RB[0]], 1, 0.2), fxRamp(["g-beam", "g-wash"], nbRamp, T.Finale)],
  });

  /* ================================================================ Finale (peak: lasers, pixel chases, blinder hits) */
  const F = LOOK.finale, fin = T.Finale;
  const laser = (name, pattern, extra = {}) => G("g-laser", col(name), { dim: 1, lzPattern: pattern, lzFan: 60, lzBeams: 16, lzSpeed: 0.5, ...extra });
  const finFx = (k) => [
    fxFan(["g-beam"], 30, 0.25), fxChase(["g-beam"], 1, 0.4, 2), fxMove(["g-spot"], k % 2 ? "eight" : "circle", 14, 0.25, 180),
    fxColor(["g-wash", "g-par"], [F[k % 4], F[(k + 1) % 4]], 0.5),
    fxPixel(k % 2 ? "rainbow" : "chase", [F[(k + 2) % 4], F[k % 4]], 1, 0.12, 720),
    fxOnset(["g-riser", "g-strobe"]), fxOnset(["g-blinder"], 0, 0.3, "add"),
  ];
  const finale = L(chorus([F[2], F[0]]), laser("Grün", 1), G("g-strobe", { dim: 1 }));
  hit("Finale", fin, finale, finFx(0));
  const step = [
    ["Finale – B", 8, L(G("g-beam", col(F[0]), beam("Prisma 3")), laser("Rot", 2, { lzFan: 80 }), G("g-spot", col(F[1])))],
    ["Finale – Drop", 12, L(G("g-beam", col(F[2]), beam("Offen")), pos("Fächer Publikum", ["g-beam"]), G("g-spot", col("Weiß")), pos("Publikum", ["g-spot"]), laser("Cyan", 1, { lzSpeed: -1 }))],
    ["Finale – C", 16, L(G("g-beam", col(F[1])), pos("Fächer hoch", ["g-beam"]), pos("Fächer Publikum", ["g-spot"]), laser("Grün", 0, { lzBeams: 8, lzSpeed: 1.5 }))],
    ["Finale – D", 20, L(G("g-beam", col(F[3])), pos("Kreuz", ["g-beam"]), G("g-spot", col(F[2]), beam("Gobo Speichen")), laser("Magenta", 1, { lzFan: 90 }))],
    ["Finale – E", 24, L(G("g-beam", col("Weiß"), beam("Prisma linear")), pos("Fächer hoch", ["g-beam"]), G("g-wash", col("Weiß")), laser("Grün", 2))],
  ];
  step.forEach(([name, n, values], k) => cue(name, bars(fin, n), { fade: name.includes("Drop") ? 0 : 0.8, color: name.includes("Drop") ? HIT : null, values, effects: finFx(k + 1) }));
  hit("Finale – Höhepunkt", bars(fin, 28), L(finale, G("g-beam", col("Weiß"), beam("Offen")), pos("Fächer Publikum", ["g-beam"]), laser("Weiß", 1, { lzFan: 90, lzBeams: 24 })), finFx(6));
  const last = bars(T.Ausklang, -1);
  cue("Finale – Schluss", last, { fade: T.Ausklang - last - 0.05, values: L(G("g-strobe", { strobe: 22 }), G("g-blinder", { dim: 0.5 })) });

  /* ================================================================ Ausklang */
  cue("Ausklang", T.Ausklang, {
    block: true, fade: 0, color: HIT,
    values: L(haze(0.6), G("g-blinder", { dim: 1 }), G("g-beam", col("Weiß"), beam("Offen"), { dim: 1 }), pos("Senkrecht", ["g-beam"])),
  });
  cue("Ausklang – Fade-out", beats(T.Ausklang, 2), { block: true, fade: 2.4, values: haze(0.3) });

  /* ================================================================ drum accents: strongest kick hits per refrain/finale phrase */
  const onsets = an?.percOnsets || [], low = an?.env?.low || [], hop = an?.env?.hop || 0.1;
  const lowAt = (t) => low[Math.max(0, Math.min(low.length - 1, Math.round(t / hop)))] || 0;
  const barLen = bars(fin, 1) - fin;
  const free = (t) => cues.every((c) => Math.abs(c.time - t) > barLen * 1.5);
  const accents = [];
  for (const [label, from, to] of [["Refrain 1", T["Refrain 1"], T["Mini-Break"]], ["Refrain 2", T["Refrain 2"], T.Bridge], ["Finale", fin, last]]) {
    const cand = onsets.filter((o) => o > from && o < to - barLen).map((o) => ({ t: snap(o), s: lowAt(o) })).sort((a, b) => b.s - a.s);
    let n = 0;
    for (const c of cand) {
      if (n >= 2 || !free(c.t) || accents.some((a) => Math.abs(a.t - c.t) < barLen * 4)) continue;
      accents.push({ label, t: c.t });
      n++;
    }
  }
  for (const a of accents) {
    cue(`${a.label} – Akzent`, a.t, { fade: 0, color: HIT, values: G("g-blinder", { dim: 1 }) });
    cue(`${a.label} – Akzent aus`, beats(a.t, 1), { fade: 0.8, values: G("g-blinder", { dim: 0 }) });
  }
  cues.sort((a, b) => a.time - b.time);
  S.cues = cues;
  S.markers = sec.map(({ time, name, color }) => ({ time, name, color }));
  S.modified = Date.now();
  return S;
}
