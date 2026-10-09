// Shared UI building blocks (fader, encoder, XY pad, segmented control, formatting).
// Markup/class names are part of the LUMEN design system (see styles.css, LUMEN_SPEC §7).

export const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);

// h("div.cls#id", {props}, ...children). props: class, style (string|object), dataset, attrs, on* handlers, other DOM props.
export function h(sel, props, ...kids) {
  if (props instanceof Node || typeof props !== "object" || props === null || Array.isArray(props)) { kids.unshift(props); props = {}; }
  const m = /^([a-z0-9-]+)?((?:[.#][\w-]+)*)$/i.exec(sel) || [];
  const el = document.createElement(m[1] || "div");
  for (const part of (m[2] || "").match(/[.#][\w-]+/g) || []) {
    if (part[0] === ".") el.classList.add(part.slice(1)); else el.id = part.slice(1);
  }
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") el.className += (el.className ? " " : "") + v;
    else if (k === "style") typeof v === "string" ? (el.style.cssText = v) : Object.assign(el.style, v);
    else if (k === "dataset") Object.assign(el.dataset, v);
    else if (k === "attrs") for (const [a, av] of Object.entries(v)) el.setAttribute(a, av);
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k in el) el[k] = v;
    else el.setAttribute(k, v);
  }
  for (const c of kids.flat(Infinity)) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}

/* ------------------------------------------------------------------ formatting */
export const de = (v, d = 0) => v.toFixed(d).replace(".", ",");
export const fmtPct = (v) => `${Math.round(v * 100)}`;
export const fmtDeg = (v) => `${de(v, Math.abs(v) < 100 ? 1 : 0)}°`;
export function fmtTime(t, frac = 2) {
  const s = Math.max(0, t);
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${m}:${r < 10 ? "0" : ""}${de(Math.floor(r * 10 ** frac) / 10 ** frac, frac)}`;
}
export function parseNum(str) {
  const v = parseFloat(String(str).replace(",", ".").replace(/[^\d.+-]/g, ""));
  return Number.isFinite(v) ? v : null;
}

// Inline numeric edit: replaces el's text with an input until Enter/blur.
export function promptValue(el, current, onCommit) {
  const inp = h("input.num-edit", { type: "text", value: String(current).replace(".", ",") });
  const rect = el.getBoundingClientRect();
  inp.style.width = Math.max(48, rect.width) + "px";
  const restore = el.textContent;
  el.textContent = "";
  el.append(inp);
  inp.focus();
  inp.select();
  let done = false;
  const finish = (ok) => {
    if (done) return;
    done = true;
    const v = parseNum(inp.value);
    inp.remove();
    el.textContent = restore;
    if (ok && v !== null) onCommit(v);
  };
  inp.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") finish(true);
    if (e.key === "Escape") finish(false);
  });
  inp.addEventListener("blur", () => finish(true));
}

// generic vertical/horizontal drag helper; cb(dx, dy, ev, phase)
export function drag(el, cb) {
  el.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    let lx = e.clientX, ly = e.clientY;
    cb(0, 0, e, "start");
    const move = (ev) => { cb(ev.clientX - lx, ev.clientY - ly, ev, "move"); lx = ev.clientX; ly = ev.clientY; };
    const up = (ev) => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      cb(0, 0, ev, "end");
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  });
}

/* ------------------------------------------------------------------ fader */
// opts: {label, value, min=0, max=1, step=0, color (css), format(v)→str, onInput(v, phase), horizontal}
export function fader(opts) {
  const o = { min: 0, max: 1, step: 0, format: fmtPct, horizontal: false, ...opts };
  let value = o.value ?? o.min;
  const fill = h("div.fader-fill");
  const knob = h("div.fader-knob");
  const track = h("div.fader-track", fill, knob);
  const val = h("div.fader-val.mono");
  const el = h(`div.fader${o.horizontal ? ".horizontal" : ""}`, { style: o.color ? `--c:${o.color}` : "" },
    o.label ? h("div.fader-label", o.label) : null, track, val);
  const q = (v) => clamp(o.step ? Math.round(v / o.step) * o.step : v, o.min, o.max);
  const paint = () => {
    const p = (value - o.min) / (o.max - o.min || 1);
    el.style.setProperty("--p", p);
    val.textContent = value === null || Number.isNaN(value) ? "–" : o.format(value);
  };
  const fromPointer = (e) => {
    const r = track.getBoundingClientRect();
    const p = o.horizontal ? (e.clientX - r.left) / r.width : 1 - (e.clientY - r.top) / r.height;
    return q(o.min + clamp(p) * (o.max - o.min));
  };
  drag(track, (dx, dy, e, phase) => {
    if (phase === "end") { el.classList.remove("dragging"); o.onInput?.(value, "end"); return; }
    if (phase === "start") el.classList.add("dragging");
    value = fromPointer(e);
    paint();
    o.onInput?.(value, phase);
  });
  track.addEventListener("wheel", (e) => {
    e.preventDefault();
    const span = o.max - o.min;
    value = q(value - Math.sign(e.deltaY) * (o.step || span / 100) * (e.shiftKey ? 10 : 1));
    paint();
    o.onInput?.(value, "wheel");
  }, { passive: false });
  val.addEventListener("dblclick", () => promptValue(val, o.format === fmtPct ? Math.round(value * 100) : value, (v) => {
    value = q(o.format === fmtPct ? v / 100 : v);
    paint();
    o.onInput?.(value, "end");
  }));
  paint();
  return {
    el,
    get: () => value,
    set(v, mixed = false) { if (el.classList.contains("dragging")) return; value = v ?? value; el.classList.toggle("mixed", mixed); paint(); },
  };
}

/* ------------------------------------------------------------------ encoder (rotary) */
// opts: {label, value, min, max, step, format, onInput(v, phase), color, sensitivity (units per px), wrap}
export function encoder(opts) {
  const o = { min: 0, max: 1, step: 0, format: (v) => de(v, 2), ...opts };
  const span = o.max - o.min;
  const sens = o.sensitivity ?? span / 200;
  let value = o.value ?? o.min;
  const dial = h("div.enc-dial", h("div.enc-ring"), h("div.enc-cap"));
  const val = h("div.enc-val.mono");
  const el = h("div.encoder", { style: o.color ? `--c:${o.color}` : "" }, dial, h("div.enc-label", o.label || ""), val);
  const q = (v) => {
    if (o.wrap) v = ((((v - o.min) % span) + span) % span) + o.min;
    v = clamp(v, o.min, o.max);
    return o.step ? Math.round(v / o.step) * o.step : v;
  };
  const paint = () => {
    el.style.setProperty("--p", (value - o.min) / (span || 1));
    val.textContent = value === null || Number.isNaN(value) ? "–" : o.format(value);
  };
  let acc = 0;
  drag(dial, (dx, dy, e, phase) => {
    if (phase === "start") { acc = value; el.classList.add("dragging"); return; }
    if (phase === "end") { el.classList.remove("dragging"); o.onInput?.(value, "end"); return; }
    acc += (dx - dy) * sens * (e.shiftKey ? 0.1 : 1);
    if (!o.wrap) acc = clamp(acc, o.min, o.max);
    value = q(acc);
    paint();
    o.onInput?.(value, "move");
  });
  dial.addEventListener("wheel", (e) => {
    e.preventDefault();
    value = q(value - Math.sign(e.deltaY) * (o.step || span / 100) * (e.shiftKey ? 0.1 : 1) * (e.altKey ? 10 : 1));
    paint();
    o.onInput?.(value, "wheel");
  }, { passive: false });
  val.addEventListener("dblclick", () => promptValue(val, Math.round(value * 100) / 100, (v) => { value = q(v); paint(); o.onInput?.(value, "end"); }));
  paint();
  return {
    el,
    get: () => value,
    set(v, mixed = false) { if (el.classList.contains("dragging")) return; value = v ?? value; el.classList.toggle("mixed", mixed); paint(); },
  };
}

/* ------------------------------------------------------------------ XY pad (pan/tilt) */
// opts: {x, y, xRange:[min,max], yRange:[min,max], onInput(x, y, phase), labelX, labelY}
export function xyPad(opts) {
  const o = { xRange: [-1, 1], yRange: [-1, 1], ...opts };
  let x = o.x ?? 0, y = o.y ?? 0;
  const dot = h("div.xy-dot");
  const area = h("div.xy-area", h("div.xy-cross-h"), h("div.xy-cross-v"), dot);
  const lab = h("div.xy-val.mono");
  const el = h("div.xypad", area, lab);
  const nx = (v) => (v - o.xRange[0]) / (o.xRange[1] - o.xRange[0]);
  const ny = (v) => (v - o.yRange[0]) / (o.yRange[1] - o.yRange[0]);
  const paint = () => {
    dot.style.left = `${nx(x) * 100}%`;
    dot.style.top = `${(1 - ny(y)) * 100}%`;
    lab.textContent = `${o.labelX || "X"} ${fmtDeg(x)} · ${o.labelY || "Y"} ${fmtDeg(y)}`;
  };
  drag(area, (dx, dy, e, phase) => {
    if (phase === "end") { el.classList.remove("dragging"); o.onInput?.(x, y, "end"); return; }
    el.classList.add("dragging");
    const r = area.getBoundingClientRect();
    if (e.shiftKey && phase === "move") {
      x = clamp(x + dx * 0.1 * ((o.xRange[1] - o.xRange[0]) / r.width), o.xRange[0], o.xRange[1]);
      y = clamp(y - dy * 0.1 * ((o.yRange[1] - o.yRange[0]) / r.height), o.yRange[0], o.yRange[1]);
    } else {
      x = o.xRange[0] + clamp((e.clientX - r.left) / r.width) * (o.xRange[1] - o.xRange[0]);
      y = o.yRange[0] + clamp(1 - (e.clientY - r.top) / r.height) * (o.yRange[1] - o.yRange[0]);
    }
    paint();
    o.onInput?.(x, y, phase);
  });
  paint();
  return { el, set(nxv, nyv) { if (el.classList.contains("dragging")) return; x = nxv ?? x; y = nyv ?? y; paint(); } };
}

/* ------------------------------------------------------------------ segmented control */
// options: [{value, label, title?}], onChange(value)
export function segmented(options, value, onChange, cls = "") {
  const el = h(`div.seg${cls ? "." + cls : ""}`);
  const btns = options.map((op) => h("button.seg-btn", {
    type: "button", title: op.title || "", dataset: { value: String(op.value) },
    onclick: () => { api.set(op.value); onChange?.(op.value); },
  }, op.label));
  el.append(...btns);
  const api = {
    el,
    set(v) { value = v; btns.forEach((b, i) => b.classList.toggle("active", options[i].value === v)); },
    get: () => value,
  };
  api.set(value);
  return api;
}

// Section with header (used by programmer/panels): returns {el, body, head}
export function section(title, opts = {}) {
  const head = h("div.sec-head", h("span.sec-title", title), opts.tools || null);
  const body = h("div.sec-body");
  const el = h("section.sec", { dataset: { sec: opts.id || "" }, style: opts.color ? `--c:${opts.color}` : "" }, head, body);
  if (opts.collapsible) head.addEventListener("click", (e) => { if (e.target === head || e.target.classList.contains("sec-title")) el.classList.toggle("collapsed"); });
  return { el, head, body };
}
