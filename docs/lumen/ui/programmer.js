// Programmer panel: selection tools, attribute faders/encoders, colour picker, pan/tilt pad, effect editor.
import { h, de, fmtDeg, fader, encoder, xyPad, segmented, section, clamp } from "./widgets.js";
import { ATTRS, ATTR_KEYS, ATTR_GROUPS, GOBOS, PRISMS, LASER_PATTERNS, SWATCHES, hasAttr, hsv2rgb, rgb2hsv, rgbCss } from "../core/fixtures.js";
import { EFFECT_FORMS, EFFECT_LABELS, EFFECT_ATTRS } from "../core/state.js";
import { btn } from "./panels.js";

const FMT = {
  zoom: (v) => fmtDeg(v), iris: (v) => `${Math.round(v * 100)} %`, focus: (v) => `${Math.round(v * 100)} %`, frost: (v) => `${Math.round(v * 100)} %`,
  gobo: (v) => GOBOS[Math.round(v)] || "–", prism: (v) => PRISMS[Math.round(v)] || "–", lzPattern: (v) => LASER_PATTERNS[Math.round(v)] || "–",
  goboSpin: (v) => `${de(v, 2)} U/s`, prismRot: (v) => `${de(v, 2)} U/s`, strobe: (v) => (v > 0 ? `${de(v, 1)} Hz` : "offen"),
  lzFan: (v) => fmtDeg(v), lzTilt: (v) => fmtDeg(v), lzBeams: (v) => String(Math.round(v)), lzSpeed: (v) => `${de(v, 1)} Hz`,
};
const GROUP_COLOR = { dim: "var(--accent)", color: "#ff5ea8", pos: "var(--accent-2)", beam: "#b48cff", shutter: "#e6edf5", laser: "var(--ok)" };
const toHex = (c) => "#" + c.map((v) => Math.round(clamp(v) * 255).toString(16).padStart(2, "0")).join("");
const fromHex = (s) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16) / 255);

export function createProgrammer(root, state, ctx = {}) {
  const { engine } = ctx;
  let views = [];         // {attrs:[...], set(values, mixed, isProg)}
  let fxSel = null, selfFx = false, lastFrame = null;

  /* ---------------------------------------------------------------- selection */
  const selCount = h("span.sel-count", "0");
  const selTypes = h("span.sel-types", "Nichts ausgewählt");
  const grpChips = h("div.chips");
  const pick = (fn) => () => {
    const sel = state.programmer.selection;
    state.select(fn(sel, state.show.fixtures.map((f) => f.id)));
  };
  const selSec = section("Auswahl", { color: "var(--sel)" });
  selSec.body.append(
    h("div.sel-info", selCount, selTypes),
    h("div.row",
      btn("small", "Alle", pick((s, all) => all)),
      btn("small", "Keine", pick(() => [])),
      btn("small", "Invertieren", pick((s, all) => all.filter((id) => !s.includes(id)))),
      btn("small", "Ungerade", pick((s) => s.filter((_, i) => i % 2 === 0)), "1., 3., 5. … der Auswahl behalten"),
      btn("small", "Gerade", pick((s) => s.filter((_, i) => i % 2 === 1)), "2., 4., 6. … der Auswahl behalten"),
      btn("small", "Gleicher Typ", pick((s, all) => {
        const types = new Set(s.map((id) => state.fixture(id)?.type));
        return all.filter((id) => types.has(state.fixture(id)?.type));
      }))),
    grpChips);

  const attrHost = h("div");
  const fxSec = section("Effekte", { color: "var(--prog)" });
  const foot = h("div.panel-foot",
    btn("primary", "Als Cue speichern", storeCue, "Programmer als Cue an der Playhead-Position speichern"),
    btn("", "Release", () => {
      if (!state.programmer.selection.length) return state.status("Keine Auswahl", "warn");
      state.releaseValues(ATTR_KEYS);
    }, "Programmer-Werte der Auswahl freigeben"),
    btn("danger", "Programmer leeren", () => state.clearProgrammer(), "Alle Werte, Effekte und die Auswahl löschen (Esc)"));
  root.append(selSec.el, attrHost, fxSec.el, foot);

  function storeCue() {
    const t = state.transport.t;
    const time = state.ui.snap ? Math.max(0, state.snapTime(t)) : t;
    state.storeCue({ time });
  }

  function renderSelection() {
    const sel = state.programmer.selection;
    selCount.textContent = String(sel.length);
    const counts = {};
    for (const id of sel) { const d = state.def(id); if (d) counts[d.name] = (counts[d.name] || 0) + 1; }
    selTypes.textContent = sel.length ? Object.entries(counts).map(([n, c]) => `${c}× ${n}`).join(", ") : "Nichts ausgewählt – Fixture im 3D-Fenster, Patch oder per Gruppe wählen";
    const set = new Set(sel);
    grpChips.replaceChildren(...state.show.groups.map((g) => {
      const n = g.fixtures.filter((id) => set.has(id)).length;
      return h(`span.chip${n && n === g.fixtures.length ? ".on" : n ? ".part" : ""}`, {
        style: `--c:${g.color || "var(--sel)"}`, title: "Klick = auswählen · Shift = hinzufügen",
        onclick: (e) => state.selectGroup(g.id, e.shiftKey ? "add" : "set"),
      }, g.name);
    }));
  }

  /* ---------------------------------------------------------------- attribute sections */
  const ids = () => state.programmer.selection;
  // current value for attr: programmer value if any, else live frame value
  function read(attr) {
    let pv, lv, mixed = false, isProg = false, first = true;
    for (const id of ids()) {
      const f = state.fixture(id);
      if (!f || !hasAttr(f.type, attr)) continue;
      const p = state.programmer.values[id]?.[attr];
      if (p !== undefined) isProg = true;
      const v = p !== undefined ? p : lastFrame?.attrs?.[id]?.[attr] ?? ATTRS[attr].def;
      if (first) { pv = v; first = false; } else if (Math.abs(v - pv) > 1e-3) mixed = true;
      if (p === undefined) lv = true;
    }
    return { v: pv, mixed: mixed || (isProg && !!lv), isProg };
  }
  const mark = (el, isProg) => { el.classList.toggle("prog", isProg); el.classList.toggle("live", !isProg); };

  function faderView(attr, label, color) {
    const w = fader({ label, value: ATTRS[attr].def, horizontal: true, color, onInput: (v) => state.setValue(attr, v) });
    views.push({ update() { const r = read(attr); w.set(r.v, r.mixed); mark(w.el, r.isProg); } });
    return w.el;
  }
  function encView(attr) {
    const s = ATTRS[attr];
    const w = encoder({
      label: s.label, value: s.def, min: s.min, max: s.max, step: s.discrete ? 1 : 0, format: FMT[attr] || ((v) => de(v, 2)),
      sensitivity: s.discrete ? (s.max - s.min) / 80 : undefined, onInput: (v) => state.setValue(attr, v),
    });
    views.push({ update() { const r = read(attr); w.set(r.v, r.mixed); mark(w.el, r.isProg); } });
    return w.el;
  }
  function sec(gk, extraTools) {
    const g = ATTR_GROUPS[gk];
    const s = section(g.label, { color: GROUP_COLOR[gk], tools: h("span.row.nowrap", extraTools || null,
      btn("small ghost", "Release", () => state.releaseValues(g.attrs), `${g.label}-Werte der Auswahl freigeben`)) });
    return s;
  }

  function colorSection(has) {
    const s = sec("color");
    const field = h("div.hsv-field");
    const cv = h("canvas");
    const markEl = h("div.hsv-mark");
    const prev = h("div.hsv-prev");
    field.append(cv, markEl);
    const paint = () => {
      const w = field.clientWidth, hgt = field.clientHeight, dpr = Math.min(2, devicePixelRatio || 1);
      if (!w) return;
      cv.width = Math.round(w * dpr); cv.height = Math.round(hgt * dpr);
      const g = cv.getContext("2d");
      const hue = g.createLinearGradient(0, 0, cv.width, 0);
      for (let i = 0; i <= 6; i++) hue.addColorStop(i / 6, `hsl(${i * 60},100%,50%)`);
      g.fillStyle = hue; g.fillRect(0, 0, cv.width, cv.height);
      const wh = g.createLinearGradient(0, 0, 0, cv.height);
      wh.addColorStop(0, "rgba(255,255,255,0)"); wh.addColorStop(1, "rgba(255,255,255,1)");
      g.fillStyle = wh; g.fillRect(0, 0, cv.width, cv.height);
    };
    new ResizeObserver(paint).observe(field);
    const setFromPointer = (e) => {
      const r = field.getBoundingClientRect();
      const hh = clamp((e.clientX - r.left) / r.width) * 360, ss = 1 - clamp((e.clientY - r.top) / r.height);
      const [r0, g0, b0] = hsv2rgb(hh, ss, 1);
      state.setValues({ r: r0, g: g0, b: b0 });
    };
    field.addEventListener("pointerdown", (e) => {
      try { field.setPointerCapture(e.pointerId); } catch (err) { /* synthetic */ }
      setFromPointer(e);
      const mv = (ev) => setFromPointer(ev);
      const up = () => { field.removeEventListener("pointermove", mv); field.removeEventListener("pointerup", up); };
      field.addEventListener("pointermove", mv);
      field.addEventListener("pointerup", up);
    });
    views.push({ update() {
      const r = read("r").v ?? 1, g = read("g").v ?? 1, b = read("b").v ?? 1, w = has.has("w") ? read("w").v ?? 0 : 0;
      const [hh, ss] = rgb2hsv(r, g, b);
      markEl.style.left = `${(hh / 360) * 100}%`;
      markEl.style.top = `${(1 - ss) * 100}%`;
      prev.style.background = rgbCss(Math.min(1, r + w), Math.min(1, g + w * 0.94), Math.min(1, b + w * 0.86));
    } });
    const sw = h("div.swatches", SWATCHES.map((c) => h("div.swatch", {
      title: c.name, style: `background:${rgbCss(Math.min(1, c.rgbw[0] + c.rgbw[3] * 0.5), Math.min(1, c.rgbw[1] + c.rgbw[3] * 0.5), Math.min(1, c.rgbw[2] + c.rgbw[3] * 0.5))}`,
      onclick: () => state.setValues({ r: c.rgbw[0], g: c.rgbw[1], b: c.rgbw[2], w: c.rgbw[3] }),
    })));
    s.body.append(h("div.hsv-wrap", field, prev), sw,
      faderView("r", "Rot", "#ff4d5e"), faderView("g", "Grün", "#44d17a"), faderView("b", "Blau", "#3e7bff"),
      has.has("w") ? faderView("w", "Weiß", "#f4f1e8") : null);
    return s.el;
  }

  function positionSection() {
    const s = sec("pos", btn("small ghost", "Home", () => state.setValues({ pan: 0, tilt: 0 }), "Pan/Tilt auf 0"));
    const pad = xyPad({ xRange: [-270, 270], yRange: [-135, 135], labelX: "Pan", labelY: "Tilt", onInput: (x, y) => state.setValues({ pan: x, tilt: y }) });
    s.body.append(pad.el, h("div.hint", "Ziehen = absolut setzen · Shift = fein"));
    views.push({ update() { const p = read("pan"), t = read("tilt"); pad.set(p.v ?? 0, t.v ?? 0); mark(pad.el, p.isProg || t.isProg); } });
    return s.el;
  }

  function renderAttrs() {
    views = [];
    const has = new Set();
    for (const id of ids()) for (const a of state.def(id)?.attrs || []) has.add(a);
    const out = [];
    if (!ids().length) out.push(h("div.empty", "Wähle Fixtures aus, um Werte zu programmieren."));
    if (has.has("dim")) {
      const s = sec("dim");
      s.body.append(faderView("dim", "Intensität", "var(--accent)"),
        h("div.row", [0, 0.25, 0.5, 0.75, 1].map((v) => btn("small", `${v * 100} %`, () => state.setValue("dim", v)))));
      out.push(s.el);
    }
    if (has.has("r")) out.push(colorSection(has));
    if (has.has("pan")) out.push(positionSection());
    for (const gk of ["beam", "shutter", "laser"]) {
      const list = ATTR_GROUPS[gk].attrs.filter((a) => has.has(a));
      if (!list.length) continue;
      const s = sec(gk, gk === "shutter" ? btn("small ghost", "Offen", () => state.setValue("strobe", 0)) : null);
      s.body.append(h("div.enc-grid", list.map(encView)));
      out.push(s.el);
    }
    attrHost.replaceChildren(...out);
    refresh();
  }
  function refresh() { for (const v of views) v.update(); }

  /* ---------------------------------------------------------------- effects */
  const fxUpdate = (patch) => { selfFx = true; try { state.updateEffect(fxSel, patch); } finally { selfFx = false; } };
  function renderFx() {
    const list = state.programmer.effects;
    if (!list.some((e) => e.id === fxSel)) fxSel = list[list.length - 1]?.id || null;
    const sel = ids();
    const can = (cap) => sel.some((id) => cap(state.def(id)));
    const add = (type) => () => {
      if (!sel.length) return state.status("Erst Fixtures auswählen", "warn");
      fxSel = state.addEffect({ type }).id;
    };
    fxSec.body.replaceChildren(
      h("div.row",
        btn("small", "+ Dimmer", add("dim"), "Dimmer-Effekt für die Auswahl"),
        h("button.btn.small", { type: "button", disabled: !can((d) => d?.caps.pantilt), onclick: add("position") }, "+ Position"),
        h("button.btn.small", { type: "button", disabled: !can((d) => d && ["rgb", "rgbw", "cmy", "wheel"].includes(d.caps.color)), onclick: add("color") }, "+ Farbe"),
        h("button.btn.small", { type: "button", disabled: !can((d) => d?.caps.pixels), onclick: add("pixel") }, "+ Pixel"),
        btn("small", "+ Attribut", add("attr"), "Attribut-Effekt (Zoom, Strobe, Laser …) für die Auswahl")),
      list.length ? h("div.fx-list", list.map((e) => h(`div.fx-item${e.id === fxSel ? ".active" : ""}`, { onclick: () => { fxSel = e.id; renderFx(); } },
        h("span.grow", h("b", EFFECT_LABELS[e.type] || e.type), e.type === "attr" ? ` ${ATTRS[e.attr]?.label || e.attr}` : "", ` · ${EFFECT_LABELS[e.form] || e.form}`),
        h("span.muted.mono", `${state.resolve(e.targets).length} Fx`),
        h("span.muted", `${de(e.speed, 2)}${e.sync === "beat" ? "/Beat" : " Hz"}`),
        h("button.btn.small.ghost", { type: "button", title: "Effekt entfernen", onclick: (ev) => { ev.stopPropagation(); state.removeEffect(e.id); } }, "×"))))
        : h("div.hint", "Keine Effekte im Programmer."),
      fxSel ? fxEditor(list.find((e) => e.id === fxSel)) : "");
  }

  function fxEditor(e) {
    const enc = (key, label, min, max, step, fmt) => encoder({ label, value: e[key], min, max, step, format: fmt || ((v) => de(v, 2)), onInput: (v) => fxUpdate({ [key]: v }) }).el;
    const seg = (key, opts) => segmented(opts, e[key], (v) => { fxUpdate(modePatch(key, v)); if (key === "sync" || (key === "mode" && isAttr)) renderFx(); }).el;
    const isDim = e.type === "dim", isAttr = e.type === "attr", lvl = isDim || isAttr;
    // attr effect switching mode: Low/High change meaning (value / factor / offset), start from a neutral range
    const modePatch = (key, v) => {
      if (key !== "mode" || !isAttr || v === e.mode) return { [key]: v };
      const s = ATTRS[e.attr] || { min: 0, max: 1 }, span = s.max - s.min;
      return v === "mul" ? { mode: v, low: 0.5, high: 1.5 } : v === "add" ? { mode: v, low: 0, high: s.discrete ? Math.max(1, Math.round(span / 4)) : span / 4 } : { mode: v, low: s.min, high: s.max };
    };
    const onsetish = e.form === "onset" || e.form === "onsetStep";
    const encD = (key, label, min, max, step, fmt, def) => encoder({ label, value: e[key] ?? def, min, max, step, format: fmt || ((v) => de(v, 2)), onInput: (v) => fxUpdate({ [key]: v }) }).el;
    const encs = [
      e.sync === "beat" ? enc("speed", "Speed", 0.0625, 4, 0.0625, (v) => `${de(v, 2)}×/Beat`) : enc("speed", "Speed", 0.05, 10, 0.05, (v) => `${de(v, 2)} Hz`),
      enc("phase", "Phase", 0, 720, 15, (v) => `${Math.round(v)}°`),
      enc("wings", "Wings", 0, 8, 1, (v) => (v <= 1 ? "aus" : String(v))),
      enc("offset", "Offset", 0, 360, 15, (v) => `${Math.round(v)}°`),
    ];
    if (isDim || (e.type === "color" && e.form === "env")) encs.push(enc("low", "Low", 0, 1, 0.01, (v) => `${Math.round(v * 100)} %`), enc("high", "High", 0, 1, 0.01, (v) => `${Math.round(v * 100)} %`));
    if (isAttr) {
      // abs: attribute range · mul: factor 0..2 · add: ±(max − min)
      const s = ATTRS[e.attr] || { min: 0, max: 1, discrete: false };
      const f = FMT[e.attr] || ((v) => de(v, 2)), st = s.discrete ? 1 : 0, span = s.max - s.min;
      if (e.mode === "mul") encs.push(encD("low", "Low", 0, 2, 0.01, (v) => `${de(v, 2)}×`, 1), encD("high", "High", 0, 2, 0.01, (v) => `${de(v, 2)}×`, 1));
      else if (e.mode === "add") encs.push(encD("low", "Low", -span, span, st, f, 0), encD("high", "High", -span, span, st, f, 0));
      else encs.push(encD("low", "Low", s.min, s.max, st, f, s.min), encD("high", "High", s.min, s.max, st, f, s.max));
    }
    if (lvl && e.form === "pattern") encs.push(encD("div", "Steps/Beat", 1, 8, 1, (v) => String(Math.round(v)), 4), encD("decay", "Decay", 0.02, 1, 0.01, (v) => `${Math.round(v * 1000)} ms`, 0.12));
    if (onsetish && e.type !== "position") encs.push(
      encD("threshold", "Schwelle", 0, 1, 0.01, (v) => `${Math.round(v * 100)} %`, 0),
      encD("decay", "Decay", 0.02, 2, 0.01, (v) => `${Math.round(v * 1000)} ms`, e.form === "onsetStep" ? 0.25 : 0.11),
      encD("every", "Jeder n.", 1, 8, 1, (v) => (v <= 1 ? "jeder" : `${Math.round(v)}.`), 1));
    if (lvl && e.form === "onsetStep") encs.push(encD("size", "Breite", 1, 8, 1, (v) => String(Math.round(v)), 1));
    if (e.type === "position" && (e.form === "random" || e.form === "step")) encs.push(enc("duty", "Fahrzeit", 0, 1, 0.05, (v) => `${Math.round(v * 100)} %`));
    if (e.type === "position") encs.push(enc("size", "Größe", 0, 90, 1, (v) => `${Math.round(v)}°`));
    if (e.type === "pixel") encs.push(enc("size", "Breite", 0.05, 1, 0.05, (v) => `${Math.round(v * 100)} %`));
    if (["square", "pulse", "chase"].includes(e.form) || (lvl && e.form === "random")) encs.push(enc("duty", "Duty", 0.05, 1, 0.05, (v) => `${Math.round(v * 100)} %`));
    if (e.type === "color" || e.type === "pixel") encs.push(enc("sat", "Sättigung", 0, 1, 0.05, (v) => `${Math.round(v * 100)} %`));
    const forms = EFFECT_FORMS[e.type] || [];
    const formCtl = forms.length > 7
      ? h("select", { onchange: (ev) => { fxUpdate({ form: ev.target.value }); renderFx(); } }, forms.map((f) => h("option", { value: f, selected: f === e.form }, EFFECT_LABELS[f] || f)))
      : segmented(forms.map((f) => ({ value: f, label: EFFECT_LABELS[f] || f })), e.form, (v) => { fxUpdate({ form: v }); renderFx(); }).el;
    const bands = [{ value: "rms", label: "Gesamt" }, { value: "low", label: "Bass" }, { value: "mid", label: "Mitten" }, { value: "high", label: "Höhen" }];
    if (onsetish || e.form === "onset") bands.push({ value: "all", label: "Alle" });
    const colors = (e.type === "color" || e.type === "pixel") && !["rainbow"].includes(e.form)
      ? h("div.row", h("span.hint", "Farben"), e.colors.map((c, i) => h("input", { type: "color", value: toHex(c), oninput: (ev) => {
        const cs = e.colors.map((x) => x.slice());
        cs[i] = fromHex(ev.target.value);
        fxUpdate({ colors: cs });
      } })),
      e.colors.length < 6 ? btn("small ghost", "+", () => { fxUpdate({ colors: [...e.colors, [1, 1, 1]] }); renderFx(); }) : null,
      e.colors.length > 1 ? btn("small ghost", "−", () => { fxUpdate({ colors: e.colors.slice(0, -1) }); renderFx(); }) : null)
      : null;
    return h("div.fx-editor",
      isAttr ? h("div.row", h("span.hint", "Attribut"), h("select", { onchange: (ev) => { fxUpdate({ attr: ev.target.value }); renderFx(); } },
        EFFECT_ATTRS.map((k) => h("option", { value: k, selected: k === e.attr }, ATTRS[k].label || k)))) : null,
      h("div.row", h("span.hint", "Form"), formCtl),
      lvl && e.form === "pattern" ? h("div.row", h("span.hint", "Pattern"), h("input.mono.grow", { type: "text", value: e.pattern || "", title: "x = Hit, o = halb, 0–9 = Stufe, = = halten, . = Pause",
        onkeydown: (ev) => ev.stopPropagation(), onchange: (ev) => { const v = ev.target.value.trim(); if (v) fxUpdate({ pattern: v }); } })) : null,
      lvl && e.form === "onsetStep" ? h("div.row", h("span.hint", "Reihenfolge"), segmented([{ value: "seq", label: "Lauf" }, { value: "random", label: "Zufall" }], e.order || "seq", (v) => fxUpdate({ order: v })).el) : null,
      h("div.row", h("span.hint", "Sync"), seg("sync", [{ value: "beat", label: "Beat" }, { value: "free", label: "Frei" }]),
        h("span.hint", "Richtung"), seg("dir", [{ value: 1, label: "→" }, { value: -1, label: "←" }])),
      lvl ? h("div.row", h("span.hint", "Modus"), seg("mode", [{ value: "mul", label: "Multipl." }, { value: "add", label: "Addieren" }, { value: "abs", label: "Absolut" }])) : null,
      (lvl || e.type === "color") && (e.form === "env" || onsetish) ? h("div.row", h("span.hint", "Band"), seg("band", bands)) : null,
      h("div.enc-grid", encs),
      colors,
      h("div.row", h("span.hint.grow", `Ziele: ${e.targets.map((t) => state.group(t)?.name || state.fixture(t)?.name || t).slice(0, 4).join(", ")}${e.targets.length > 4 ? " …" : ""}`),
        btn("small", "Ziele = Auswahl", () => { if (ids().length) { fxUpdate({ targets: [...ids()] }); renderFx(); } })));
  }

  /* ---------------------------------------------------------------- wiring */
  state.on("selection:changed", () => { renderSelection(); renderAttrs(); renderFx(); });
  state.on("show:changed", ({ scope }) => { if (scope === "all" || scope === "patch" || scope === "groups") { renderSelection(); renderAttrs(); } });
  state.on("programmer:changed", (e) => { if (e.effects && !selfFx) renderFx(); refresh(); });
  renderSelection();
  renderAttrs();
  renderFx();

  return {
    tick(frame) {
      lastFrame = frame || engine?.frame || lastFrame;
      if (root.offsetParent !== null) refresh();
    },
  };
}
