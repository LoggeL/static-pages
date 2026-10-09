// Cue timeline (canvas): ruler with bars, song sections, energy lanes, beat grid, cue blocks with fade ramps,
// playhead, drag with beat snap; cue list view with GO; cue inspector.
import { h, de, fmtTime, segmented, clamp } from "./widgets.js";
import { btn } from "./panels.js";

const C = {
  bg: "#0e1116", lane: "#12161c", line: "#262c37", line2: "#323a47", text: "#a3adbb", text3: "#6b7684",
  accent: "#ffb000", accent2: "#3ec5ff", sel: "#3ec5ff", low: "#ffb000", mid: "#3ec5ff", high: "#e6edf5", rms: "#3a4352",
};
const SECT_COLORS = ["#2a3140", "#232a36"];
const withA = (col, a) => (/^#[0-9a-f]{6}$/i.test(col || "") ? col : C.accent) + Math.round(a * 255).toString(16).padStart(2, "0");
const RULER = 24, SECT = 20, MIN_PPS = 2, MAX_PPS = 600;
const typing = (e) => /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
const stop = (e) => e.stopPropagation();

export function createTimeline(root, state, ctx = {}) {
  const { audio } = ctx;
  let reveal = true, scroll = 0, W = 0, H = 0, dpr = 1, lastT = -1, dirty = true, staticKey = "", dragging = null, view = "timeline", curIdx = -2;
  const pps = () => clamp(state.ui.pxPerSec || 40, MIN_PPS, MAX_PPS);
  const dur = () => state.transport.duration || state.show.audio.duration || 204;
  const now = () => (audio ? audio.time() : state.transport.t);
  const seek = (t) => { t = clamp(t, 0, dur()); if (audio) audio.seek(t); else state.setTransport({ t }); dirty = true; };

  /* ---------------------------------------------------------------- DOM */
  const canvas = h("canvas.tl-canvas");
  const off = document.createElement("canvas");
  const listWrap = h("div.tl-list", { hidden: true });
  const main = h("div.tl-main", canvas, listWrap);
  const insp = h("div.tl-insp", { hidden: true });
  const cueInfo = h("span.tl-cueinfo.grow");
  const snapBtn = btn("small", "Snap", () => state.setUI("snap", !state.ui.snap), "Cues auf Beats einrasten (Alt beim Ziehen = frei)");
  const followBtn = btn("small", "Folgen", () => state.setUI("follow", !state.ui.follow), "Ansicht folgt dem Playhead");
  const viewSeg = segmented([{ value: "timeline", label: "Timeline" }, { value: "list", label: "Cue-Liste" }], view, (v) => setView(v));
  const goNext = () => {
    const cues = state.show.cues, i = state.cueIndexAt(now()) + 1;
    if (!cues[i]) return state.status("Kein weiterer Cue", "warn");
    seek(cues[i].time);
    state.setUI("cueId", cues[i].id);
  };
  const goPrev = () => {
    const cues = state.show.cues, t = now();
    let i = state.cueIndexAt(t);
    if (cues[i] && t - cues[i].time < 0.4) i--;
    if (i < 0) return seek(0);
    seek(cues[i].time);
    state.setUI("cueId", cues[i].id);
  };
  root.append(
    h("div.tl-bar", viewSeg.el,
      btn("small icon", "−", () => zoomTo(pps() / 1.5), "Herauszoomen (Strg+Mausrad)"),
      btn("small icon", "+", () => zoomTo(pps() * 1.5), "Hineinzoomen"),
      btn("small", "Alles", () => { zoomTo(Math.max(MIN_PPS, (W - 20) / dur())); scrollTo(0); }, "Ganzen Song zeigen"),
      snapBtn, followBtn,
      btn("small", "+ Cue", addCueAtPlayhead, "Leeren Cue an der Playhead-Position anlegen"),
      cueInfo,
      btn("small", "◀", goPrev, "Vorheriger Cue"),
      btn("small primary tl-go", "GO", goNext, "Zum nächsten Cue")),
    h("div.tl-body", main, insp));

  function setView(v) {
    view = v;
    viewSeg.set(v);
    canvas.hidden = v !== "timeline";
    listWrap.hidden = v !== "list";
    if (v === "list") { renderList(); curIdx = -2; }
    dirty = true;
  }
  const syncBtns = () => { snapBtn.classList.toggle("on", !!state.ui.snap); followBtn.classList.toggle("on", !!state.ui.follow); };

  function addCueAtPlayhead() {
    const t = now(), time = state.ui.snap ? Math.max(0, state.snapTime(t)) : t;
    const c = state.addCue({ time, name: `Cue ${state.show.cues.length + 1}` });
    state.setUI("cueId", c.id);
  }

  /* ---------------------------------------------------------------- geometry */
  const xOf = (t) => (t - scroll) * pps();
  const tOf = (x) => scroll + x / pps();
  const envH = () => clamp(Math.round((H - RULER - SECT) * 0.38), 24, 70);
  const cueTop = () => RULER + SECT + envH();
  function resize() {
    const r = main.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = Math.max(1, Math.round(r.width));
    H = Math.max(1, Math.round(r.height));
    for (const c of [canvas, off]) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
    staticKey = "";
    dirty = true;
  }
  new ResizeObserver(resize).observe(main);

  function zoomTo(v, anchorT) {
    const a = anchorT ?? tOf(W / 2), ax = xOf(a);
    state.setUI("pxPerSec", clamp(v, MIN_PPS, MAX_PPS));
    scroll = a - ax / pps();
    clampScroll();
    dirty = true;
  }
  function scrollTo(t) { scroll = t; clampScroll(); dirty = true; }
  function clampScroll() { scroll = clamp(scroll, -0.5, Math.max(-0.5, dur() - W / pps() + 1)); }

  /* ---------------------------------------------------------------- static layer */
  function sections() {
    const m = state.show.markers;
    if (m?.length) return m.map((x, i) => ({ t0: x.time, t1: m[i + 1]?.time ?? dur(), name: x.name, color: x.color }));
    const s = state.show.audio.segments || [];
    return s.map((t, i) => ({ t0: t, t1: s[i + 1] ?? dur(), name: `Teil ${i + 1}` }));
  }
  function drawStatic() {
    const g = off.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = C.bg;
    g.fillRect(0, 0, W, H);
    const P = pps(), t0 = tOf(0), t1 = tOf(W), eh = envH(), cy = cueTop();
    g.fillStyle = C.lane;
    g.fillRect(0, RULER, W, SECT);
    g.fillRect(0, RULER + SECT, W, eh);
    g.font = "10px ui-monospace, Menlo, monospace";
    g.textBaseline = "middle";

    // beat grid
    const beats = state.show.audio.beats || [], bpb = state.show.audio.beatsPerBar || 4, down = state.show.audio.downbeat || 0;
    const beatPx = (60 / (state.show.audio.bpm || 120)) * P;
    const barEvery = beatPx * bpb >= 30 ? 1 : beatPx * bpb >= 8 ? 4 : 16;
    const b0 = Math.max(0, Math.floor(state.beatAt(t0)) - 1), b1 = Math.ceil(state.beatAt(t1)) + 1;
    for (let b = b0; b <= b1; b++) {
      const t = beats.length > 1 && b < beats.length ? beats[b] : state.timeAtBeat(b);
      if (t > dur()) break;
      const rel = b - down, isBar = ((rel % bpb) + bpb) % bpb === 0, bar = Math.floor(rel / bpb) + 1;
      if (!isBar && beatPx < 6) continue;
      if (isBar && (bar - 1) % barEvery !== 0 && barEvery > 1) continue;
      const x = Math.round(xOf(t)) + 0.5;
      g.fillStyle = isBar ? "rgba(255,255,255,.07)" : "rgba(255,255,255,.03)";
      g.fillRect(x, RULER, 1, H - RULER);
      if (isBar && beatPx * bpb * barEvery >= 22) {
        g.fillStyle = C.text3;
        g.fillRect(x, RULER - 7, 1, 7);
        g.fillText(String(bar), x + 3, RULER - 5);
      }
    }
    // ruler time labels
    const step = [1, 2, 5, 10, 15, 30, 60].find((s) => s * P >= 70) || 120;
    g.fillStyle = C.text;
    for (let s = Math.max(0, Math.floor(t0 / step) * step); s <= Math.min(t1, dur()); s += step) {
      const x = Math.round(xOf(s)) + 0.5;
      g.fillRect(x, 0, 1, 9);
      g.fillText(fmtTime(s, 0), x + 3, 8);
    }
    g.fillStyle = C.line;
    g.fillRect(0, RULER - 0.5, W, 1);
    // end of song
    const xe = xOf(dur());
    if (xe < W) { g.fillStyle = "rgba(0,0,0,.45)"; g.fillRect(xe, RULER, W - xe, H - RULER); }

    // sections
    g.save();
    sections().forEach((s, i) => {
      const xa = xOf(s.t0), xb = xOf(s.t1);
      if (xb < 0 || xa > W) return;
      g.fillStyle = s.color ? withA(s.color, 0.2) : SECT_COLORS[i % 2];
      g.fillRect(xa, RULER + 1, xb - xa - 1, SECT - 2);
      g.fillStyle = s.color || C.text3;
      g.fillRect(xa, RULER + 1, 2, SECT - 2);
      g.save();
      g.beginPath();
      g.rect(xa, RULER, Math.max(0, xb - xa - 4), SECT);
      g.clip();
      g.fillStyle = C.text;
      g.font = "600 11px system-ui, sans-serif";
      g.fillText(s.name, Math.max(xa, 0) + 6, RULER + SECT / 2 + 0.5);
      g.restore();
    });
    g.restore();

    // energy lane
    const env = state.analysis?.env;
    const ey = RULER + SECT, mid = ey + eh / 2;
    if (env?.rms?.length) {
      const hop = env.hop || 0.1;
      const val = (arr, t) => {
        const f = t / hop, i = Math.floor(f);
        if (i < 0 || i >= arr.length - 1) return 0;
        return arr[i] + (arr[i + 1] - arr[i]) * (f - i);
      };
      const xs = Math.max(0, xOf(0)), xEnd = Math.min(W, xOf(dur()));
      g.fillStyle = C.rms;
      g.beginPath();
      g.moveTo(xs, mid);
      for (let x = xs; x <= xEnd; x++) g.lineTo(x, mid - val(env.rms, tOf(x)) * eh * 0.48);
      for (let x = xEnd; x >= xs; x--) g.lineTo(x, mid + val(env.rms, tOf(x)) * eh * 0.48);
      g.closePath();
      g.fill();
      for (const [band, col] of [["low", C.low], ["mid", C.mid], ["high", C.high]]) {
        const arr = env[band];
        if (!arr?.length) continue;
        g.strokeStyle = col;
        g.globalAlpha = band === "high" ? 0.45 : 0.7;
        g.lineWidth = 1;
        g.beginPath();
        for (let x = xs; x <= xEnd; x += 2) g[x === xs ? "moveTo" : "lineTo"](x, ey + eh - 2 - val(arr, tOf(x)) * (eh - 4));
        g.stroke();
      }
      g.globalAlpha = 1;
      g.fillStyle = C.text3;
      g.fillText("Bass · Mitten · Höhen", 6, ey + 8);
    } else {
      g.fillStyle = C.text3;
      g.fillText("Keine Audio-Analyse geladen", 6, mid);
    }
    g.fillStyle = C.line;
    g.fillRect(0, cy - 0.5, W, 1);

    // cues
    const cues = state.show.cues, ch = H - cy;
    cues.forEach((c, i) => {
      const xa = xOf(c.time), nx = i + 1 < cues.length ? xOf(cues[i + 1].time) : xOf(dur());
      if (nx < 0 || xa > W) return;
      const col = c.color || C.accent, selc = c.id === state.ui.cueId;
      g.fillStyle = withA(col, 0.11);
      g.fillRect(xa, cy + 1, nx - xa, ch - 1);
      // fade ramp
      const fa = xa + (c.delay || 0) * P, fb = fa + Math.max(0.0001, c.fade || 0) * P;
      g.fillStyle = withA(col, 0.22);
      g.beginPath();
      g.moveTo(fa, H);
      g.lineTo(Math.min(fb, nx), H - (ch - 18) * Math.min(1, (Math.min(fb, nx) - fa) / (fb - fa || 1)));
      g.lineTo(Math.min(fb, nx), H);
      g.closePath();
      g.fill();
      g.strokeStyle = col;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(fa, H);
      g.lineTo(fb, H - (ch - 18));
      g.stroke();
      g.fillStyle = col;
      g.fillRect(xa, cy + 1, 2, ch - 1);
      if (c.block) g.fillRect(xa, cy + 1, 7, 3);
      if (selc) { g.strokeStyle = C.sel; g.lineWidth = 2; g.strokeRect(xa + 1, cy + 2, Math.max(4, nx - xa - 2), ch - 3); }
      g.save();
      g.beginPath();
      g.rect(xa, cy, Math.max(0, nx - xa - 3), ch);
      g.clip();
      g.fillStyle = selc ? "#fff" : C.text;
      g.font = "600 11px system-ui, sans-serif";
      g.fillText(c.name, xa + 6, cy + 10);
      g.fillStyle = C.text3;
      g.font = "10px ui-monospace, Menlo, monospace";
      g.fillText(`${i + 1} · F ${de(c.fade || 0, 1)}${c.effects?.length ? ` · ${c.effects.length} FX` : ""}`, xa + 6, cy + 23);
      g.restore();
    });
    if (!cues.length) {
      g.fillStyle = C.text3;
      g.font = "12px system-ui, sans-serif";
      g.fillText("Noch keine Cues – im Programmer „Als Cue speichern“ oder Doppelklick hier", 10, cy + ch / 2);
    }
  }

  /* ---------------------------------------------------------------- frame draw */
  let infoTimer = 0;
  function draw(t) {
    if (t === undefined) t = now();
    if (view === "list" || !W || canvas.offsetParent === null) { updateInfo(t); return; }
    if (state.ui.follow && (state.transport.playing || reveal) && !dragging) {
      const x = xOf(t);
      if (x > W * 0.85 || x < 0) { scroll = t - (W * 0.2) / pps(); clampScroll(); }
    }
    reveal = false;
    const key = `${scroll.toFixed(4)}|${pps()}|${W}|${H}`;
    if (key !== staticKey || dirty) { drawStatic(); staticKey = key; dirty = false; }
    else if (t === lastT) return;
    lastT = t;
    const g = canvas.getContext("2d");
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(off, 0, 0);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const x = Math.round(xOf(t)) + 0.5;
    if (x >= 0 && x <= W) {
      g.fillStyle = C.accent2;
      g.fillRect(x - 0.5, 0, 1.5, H);
      g.beginPath();
      g.moveTo(x - 6, 0); g.lineTo(x + 6, 0); g.lineTo(x, 8); g.closePath();
      g.fill();
    }
    if (dragging?.cue && dragging.moved) {
      const c = state.cue(dragging.cue);
      if (c) {
        const b = state.barAt(c.time), lbl = `${fmtTime(c.time)} · ${b.bar}.${b.beat}`;
        const cx = xOf(c.time);
        g.font = "11px ui-monospace, Menlo, monospace";
        const w = g.measureText(lbl).width + 10;
        g.fillStyle = "rgba(0,0,0,.85)";
        g.fillRect(cx + 4, cueTop() - 20, w, 16);
        g.fillStyle = "#fff";
        g.textBaseline = "middle";
        g.fillText(lbl, cx + 9, cueTop() - 12);
      }
    }
    updateInfo(t);
  }
  function updateInfo(t) {
    const i = state.cueIndexAt(t), cues = state.show.cues;
    if (i !== curIdx) {
      curIdx = i;
      if (view === "list") for (const tr of listWrap.querySelectorAll("tbody tr")) {
        tr.classList.toggle("current", +tr.dataset.i === i);
        if (+tr.dataset.i === i && state.ui.follow) tr.scrollIntoView({ block: "nearest" });
      }
      infoTimer = 0;
    }
    if (infoTimer-- > 0) return;
    infoTimer = 6;
    const c = cues[i], n = cues[i + 1];
    const txt = `${c ? c.name : "–"}|${n ? `${n.name} in ${de(Math.max(0, n.time - t), 1)} s` : "Ende"}`;
    if (cueInfo.dataset.txt === txt) return;
    cueInfo.dataset.txt = txt;
    cueInfo.replaceChildren("Aktiv: ", h("b", c ? c.name : "–"), ` · Nächster: ${n ? `${n.name} in ${de(Math.max(0, n.time - t), 1)} s` : "Ende"}`);
  }

  /* ---------------------------------------------------------------- pointer */
  function cueHit(x, y) {
    if (y < cueTop()) return null;
    const cues = state.show.cues;
    for (const c of cues) if (Math.abs(xOf(c.time) - x) <= 6) return c;
    const i = state.cueIndexAt(tOf(x));
    return cues[i] || null;
  }
  const local = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  canvas.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const [x, y] = local(e);
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* synthetic */ }
    const c = cueHit(x, y);
    if (c) {
      state.setUI("cueId", c.id);
      dragging = { cue: c.id, x0: x, off: tOf(x) - c.time, moved: false };
    } else {
      dragging = { seek: true };
      seek(tOf(x));
    }
    dirty = true;
  });
  canvas.addEventListener("pointermove", (e) => {
    const [x, y] = local(e);
    if (!dragging) { canvas.style.cursor = y >= cueTop() && state.show.cues.some((c) => Math.abs(xOf(c.time) - x) <= 6) ? "ew-resize" : y < cueTop() ? "text" : "default"; return; }
    if (dragging.seek) return seek(tOf(x));
    if (!dragging.moved && Math.abs(x - dragging.x0) < 4) return;
    dragging.moved = true;
    let t = Math.max(0, tOf(x) - dragging.off);
    if (state.ui.snap && !e.altKey) t = Math.max(0, state.snapTime(t, e.shiftKey ? 2 : 1));
    t = Math.round(t * 1000) / 1000;
    const c = state.cue(dragging.cue);
    if (c && c.time !== t) state.updateCue(c.id, { time: t }, { coalesce: "cue-drag", label: "Cue verschieben" });
  });
  const endDrag = () => { if (dragging?.moved) state.status("Cue verschoben"); dragging = null; dirty = true; };
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);
  canvas.addEventListener("dblclick", (e) => {
    const [x, y] = local(e);
    if (y < cueTop()) return;
    const c = cueHit(x, y);
    if (c) {
      state.setUI("cueId", c.id);
      requestAnimationFrame(() => insp.querySelector("input")?.focus());
      return;
    }
    let t = tOf(x);
    if (state.ui.snap) t = Math.max(0, state.snapTime(t));
    const n = state.addCue({ time: t, name: `Cue ${state.show.cues.length + 1}` });
    state.setUI("cueId", n.id);
  });
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) return zoomTo(pps() * Math.exp(-e.deltaY * 0.0025), tOf(local(e)[0]));
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    scroll += d / pps();
    clampScroll();
    dirty = true;
  }, { passive: false });
  window.addEventListener("keydown", (e) => {
    if (typing(e) || (e.key !== "Delete" && e.key !== "Backspace")) return;
    const c = state.cue(state.ui.cueId);
    if (!c || root.offsetParent === null) return;
    e.preventDefault();
    state.removeCue(c.id);
    state.status(`Cue „${c.name}“ gelöscht`);
  });

  /* ---------------------------------------------------------------- cue list */
  function renderList() {
    const cues = state.show.cues;
    const body = h("tbody", cues.map((c, i) => {
      const b = state.barAt(c.time);
      return h(`tr${c.id === state.ui.cueId ? ".sel" : ""}`, { dataset: { i, id: c.id },
        onclick: () => state.setUI("cueId", c.id), ondblclick: () => seek(c.time), title: "Doppelklick = hinspringen" },
      h("td.mono.muted", String(i + 1)),
      h("td", h("span", { style: `display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:6px;background:${c.color || C.accent}` }), c.name),
      h("td.mono", fmtTime(c.time)), h("td.mono.muted", `${b.bar}.${b.beat}`),
      h("td.mono.num", de(c.fade || 0, 1)), h("td.mono.num", de(c.delay || 0, 1)),
      h("td.muted", `${Object.keys(c.values || {}).length} Ziele · ${c.effects?.length || 0} FX${c.block ? " · Block" : ""}${c.kill?.length ? " · Kill" : ""}`));
    }));
    listWrap.replaceChildren(h("table.tbl", h("thead", h("tr", ["#", "Name", "Zeit", "Takt", "Fade", "Delay", "Inhalt"].map((t) => h("th", t)))), body),
      cues.length ? null : h("div.empty", "Keine Cues."));
    curIdx = -2;
  }

  /* ---------------------------------------------------------------- inspector */
  function renderInspector() {
    const c = state.cue(state.ui.cueId);
    insp.hidden = !c;
    if (!c || insp.contains(document.activeElement)) return;
    const upd = (patch, label) => state.updateCue(c.id, patch, { label });
    const num = (key, label, min, max) => h("label.field", label, h("input", {
      type: "number", step: 0.1, min, max, value: c[key] ?? 0, onkeydown: stop,
      onchange: (e) => { const v = parseFloat(String(e.target.value).replace(",", ".")); if (Number.isFinite(v)) upd({ [key]: clamp(v, min, max) }, `Cue ${label}`); },
    }));
    const b = state.barAt(c.time);
    const targets = Object.keys(c.values || {}).map((id) => state.group(id)?.name || state.fixture(id)?.name || id);
    insp.replaceChildren(
      h("h4", h("span.grow", "Cue"), btn("small ghost", "×", () => state.setUI("cueId", null), "Schließen")),
      h("label.field", "Name", h("input", { type: "text", value: c.name, onkeydown: stop, onchange: (e) => e.target.value.trim() && upd({ name: e.target.value.trim() }, "Cue umbenennen") })),
      h("div.grid2", num("time", "Zeit (s)", 0, dur()), h("label.field", "Takt", h("input", { type: "text", value: `${b.bar}.${b.beat}`, disabled: true })),
        num("fade", "Fade (s)", 0, 60), num("delay", "Delay (s)", 0, 60)),
      h("div.row",
        h("label.row.hint", h("input", { type: "checkbox", checked: !!c.block, onchange: (e) => upd({ block: e.target.checked }, "Cue Block") }), "Block"),
        h("label.row.hint", "Farbe", h("input", { type: "color", value: /^#[0-9a-f]{6}$/i.test(c.color || "") ? c.color : "#ffb000", onchange: (e) => upd({ color: e.target.value }, "Cue-Farbe") }))),
      h("div.hint", `${targets.length} Ziele${targets.length ? ": " + targets.slice(0, 5).join(", ") + (targets.length > 5 ? " …" : "") : ""} · ${c.effects?.length || 0} Effekte${c.kill?.length ? ` · Kill: ${c.kill.length}` : ""}`),
      h("div.grid2",
        btn("small", "Hinspringen", () => seek(c.time)),
        btn("small", "Auf Beat", () => upd({ time: Math.max(0, state.snapTime(c.time)) }, "Cue auf Beat")),
        btn("small", "Programmer → Cue", () => state.storeCue({ cueId: c.id, mode: "merge" }), "Programmer-Inhalt in diesen Cue übernehmen"),
        btn("small", "Duplizieren", () => {
          const d = state.duplicateCue(c.id, state.timeAtBeat(Math.round(state.beatAt(c.time)) + 4));
          if (d) state.setUI("cueId", d.id);
        }, "Kopie einen Takt später")),
      btn("small danger", "Cue löschen", () => state.removeCue(c.id)));
  }

  /* ---------------------------------------------------------------- wiring */
  state.on("show:changed", ({ scope }) => {
    dirty = true;
    if (scope === "cues" || scope === "all") { if (view === "list") renderList(); renderInspector(); }
  });
  state.on("ui:changed", ({ key }) => {
    if (key === "cueId") { dirty = true; renderInspector(); if (view === "list") renderList(); }
    if (key === "snap" || key === "follow") syncBtns();
    if (key === "pxPerSec") dirty = true;
  });
  state.on("transport:changed", () => { dirty = true; if (!dragging) reveal = true; });
  syncBtns();
  setView("timeline");

  return { draw, zoomTo, scrollTo, setView };
}
