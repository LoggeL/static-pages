// Topbar, viewport HUD, sidebar tabs (Patch, Gruppen & Presets, DMX, Show), executor bar, status bar, file handling.
import { h, de, fmtTime, fader, segmented, section, promptValue, clamp } from "./widgets.js";
import { TYPE_KEYS, getType, channelAt, channelLabel } from "../core/fixtures.js";
import { createShow, applyAnalysis, STORAGE_KEY } from "../core/state.js";

const $ = (s) => document.querySelector(s);
const setText = (el, s) => { if (el.textContent !== s) el.textContent = s; };
const typing = (e) => /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;

/* ------------------------------------------------------------------ icons */
const ICONS = {
  play: ["M7 4.5v15l12.5-7.5z"], pause: ["M6 4h4.5v16H6zm7.5 0H18v16h-4.5z"],
  start: ["M5 4h2.5v16H5zM20 4.5v15L9 12z"], prev: ["M18 5v14l-9-7zM6 5h2.5v14H6z"], next: ["M6 5v14l9-7zM15.5 5H18v14h-2.5z"],
  undo: ["M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 010 11H11", 1], redo: ["M15 14l5-5-5-5M20 9H9.5a5.5 5.5 0 000 11H13", 1],
  save: ["M5 3h11l3 3v15H5zM8 3v5h7V3M8 21v-7h8v7", 1], download: ["M12 4v11M7 10l5 5 5-5M5 20h14", 1],
  upload: ["M12 16V5M7 10l5-5 5 5M5 20h14", 1], music: ["M9 18V6l11-2v12M9 18a3 3 0 11-6 0 3 3 0 016 0zM20 16a3 3 0 11-6 0 3 3 0 016 0z", 1],
  click: ["M8 21h8L13 4h-2zM12 15l6-8", 1], trash: ["M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13", 1], plus: ["M12 5v14M5 12h14", 1],
};
export function icon(name) {
  const [d, stroke] = ICONS[name] || ICONS.plus;
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 24 24");
  s.setAttribute("aria-hidden", "true");
  const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
  p.setAttribute("d", d);
  if (stroke) Object.entries({ fill: "none", stroke: "currentColor", "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round" }).forEach(([k, v]) => p.setAttribute(k, v));
  s.append(p);
  return s;
}
export const btn = (cls, content, onclick, title) =>
  h(`button.btn${cls ? "." + cls.split(" ").join(".") : ""}`, { type: "button", title: title || "", onclick }, content);

// Inline text edit (names): replaces el's text with an input until Enter/blur.
export function editText(el, current, onCommit) {
  const inp = h("input", { type: "text", value: current, style: "height:22px;width:100%" });
  const restore = el.textContent;
  el.textContent = "";
  el.append(inp);
  inp.focus();
  inp.select();
  let done = false;
  const finish = (ok) => {
    if (done) return;
    done = true;
    const v = inp.value.trim();
    inp.remove();
    el.textContent = restore;
    if (ok && v && v !== current) onCommit(v);
  };
  inp.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") finish(true); if (e.key === "Escape") finish(false); });
  inp.addEventListener("blur", () => finish(true));
  inp.addEventListener("click", (e) => e.stopPropagation());
}

const CAMS = [["foh", "FOH"], ["front", "Front"], ["top", "Draufsicht"], ["side", "Seite"], ["drums", "Drums"], ["free", "Frei"]];
const TABS = [["programmer", "Programmer", "Prog."], ["patch", "Patch"], ["library", "Gruppen & Presets", "Presets"], ["dmx", "DMX"], ["show", "Show"], ["timeline", "Timeline", null, true]];
const KIND_LABEL = { color: "Farben", position: "Positionen", beam: "Beam", dim: "Dimmer" };
const KIND_COLOR = { color: "#ff5ea8", position: "#3ec5ff", beam: "#b48cff", dim: "#ffb000" };

export function createPanels(state, ctx = {}) {
  const { audio, engine } = ctx;
  const ticks = [];
  const fileInput = $("#file-input");

  /* ---------------------------------------------------------------- show helpers */
  function newShow() {
    const s = createShow({ name: "Neue Show" });
    applyAnalysis(s, state.analysis);
    state.load(s, { undoable: true, label: "Neue Show" });
    state.status("Neue Show mit Standard-Rigg angelegt", "ok");
  }
  async function loadDemo() {
    try {
      const m = await import("../demo/drum-show.js");
      state.load(m.createDemoShow(state.analysis), { undoable: true, label: "Demo laden" });
      state.status("Demo-Show „Drum Show“ geladen", "ok");
      return true;
    } catch (e) {
      console.error(e);
      state.status(`Demo konnte nicht geladen werden: ${e.message}`, "error");
      return false;
    }
  }
  function exportShow() {
    const blob = new Blob([state.exportJSON()], { type: "application/json" });
    const a = h("a", { href: URL.createObjectURL(blob), download: `${(state.show.name || "show").replace(/[^\wäöüÄÖÜß -]+/g, "").trim() || "show"}.lumen.json` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    state.status("Show als JSON exportiert", "ok");
  }
  const save = () => {
    const ok = state.saveLocal();
    state.status(ok ? "Show im Browser gespeichert" : "Speichern nicht möglich (Speicher blockiert)", ok ? "ok" : "warn");
  };
  const pickFile = (accept) => { fileInput.accept = accept; fileInput.value = ""; fileInput.click(); };
  const pickAudio = () => pickFile("audio/*,.mp3,.wav,.ogg,.m4a");
  const pickShow = () => pickFile(".json,application/json");
  function handleFile(f) {
    if (!f) return;
    if (/\.json$/i.test(f.name) || f.type === "application/json") f.text().then((s) => state.importJSON(s));
    else if (/\.(mp3|wav|ogg|m4a|flac|aac)$/i.test(f.name) || f.type.startsWith("audio/")) {
      if (!audio?.loadFile) return state.status("Audio-Modul nicht verfügbar", "error");
      audio.loadFile(f).catch((e) => state.status(`Audio konnte nicht geladen werden: ${e.message}`, "error"));
    } else state.status(`Unbekanntes Dateiformat: ${f.name}`, "warn");
  }
  fileInput.addEventListener("change", () => [...fileInput.files].forEach(handleFile));

  /* ---------------------------------------------------------------- topbar */
  const showName = h("span.show-name");
  $("#brand").append(h("div.logo", h("span.logo-mark"), "LUMEN"), showName);

  const playBtn = btn("play icon", icon("play"), () => audio?.toggle(), "Play/Pause (Leertaste)");
  const clickBtn = btn("icon ghost", icon("click"), () => { if (!audio) return; audio.click = !audio.click; clickBtn.classList.toggle("on", audio.click); }, "Beat-Klick an/aus");
  const cueJump = (dir) => {
    const t = audio ? audio.time() : state.transport.t, cues = state.show.cues;
    if (!cues.length) return;
    let i = state.cueIndexAt(t);
    if (dir < 0) i = cues[i] && t - cues[i].time < 0.4 ? i - 1 : i; else i += 1;
    const c = cues[clamp(i, 0, cues.length - 1)];
    audio?.seek(c.time);
    state.setUI("cueId", c.id);
  };
  $("#transport").append(
    btn("icon ghost", icon("start"), () => audio?.stop(), "Zum Anfang (Pos1)"),
    btn("icon ghost", icon("prev"), () => cueJump(-1), "Vorheriger Cue"),
    playBtn,
    btn("icon ghost", icon("next"), () => cueJump(1), "Nächster Cue"),
    clickBtn,
  );
  const clk = { time: h("span.clk-time.mono", "0:00,00"), bar: h("b.mono", "1.1"), bpm: h("b.mono", "–"), cue: h("b", "–") };
  $("#clock").append(clk.time, h("span.clk-item", "Takt", clk.bar), h("span.clk-item.clk-hide-m", "BPM", clk.bpm), h("span.clk-item.clk-cue", "Cue", clk.cue));

  const gm = fader({ label: "GM", value: state.live.grandmaster, horizontal: true, color: "var(--accent)", onInput: (v) => state.setGrandmaster(v) });
  const boBtn = btn("danger", "B.O.", () => state.setBlackout(!state.live.blackout), "Blackout");
  $("#master").append(gm.el, boBtn);

  const undoBtn = btn("icon ghost", icon("undo"), () => state.undo(), "Rückgängig (Strg+Z)");
  const redoBtn = btn("icon ghost", icon("redo"), () => state.redo(), "Wiederholen (Strg+Y)");
  $("#toolbar").append(undoBtn, redoBtn, h("span.tb-sep"),
    btn("ghost", [icon("save"), h("span.lbl-s", "Speichern")], save, "Im Browser speichern (Strg+S)"),
    btn("ghost", [icon("download"), h("span.lbl-s", "Export")], exportShow, "Show als JSON exportieren"),
    btn("ghost", [icon("upload"), h("span.lbl-s", "Import")], pickShow, "Show-JSON importieren"),
    h("span.tb-sep"),
    btn("", [icon("music"), "Song laden"], pickAudio, "MP3/WAV/OGG laden (auch per Drag & Drop)"));

  const syncHistory = () => { undoBtn.disabled = !state.canUndo(); redoBtn.disabled = !state.canRedo(); };
  state.on("history:changed", syncHistory);
  syncHistory();
  const syncTransport = () => {
    const p = state.transport.playing;
    playBtn.classList.toggle("on", p);
    playBtn.replaceChildren(icon(p ? "pause" : "play"));
  };
  state.on("transport:changed", syncTransport);
  state.on("audio:loaded", () => clickBtn.classList.toggle("on", !!audio?.click));
  state.on("live:changed", (e) => {
    if (e.key === "grandmaster") gm.set(state.live.grandmaster);
    if (e.key === "blackout") boBtn.classList.toggle("on", state.live.blackout);
  });

  ticks.push((frame) => {
    const t = frame.t ?? state.transport.t;
    setText(clk.time, fmtTime(t));
    const b = state.barAt(t);
    setText(clk.bar, `${b.bar}.${b.beat}`);
    setText(clk.bpm, de(frame.bpm || state.bpmAt(t), 1));
    setText(clk.cue, state.cue(frame.cueId)?.name || "–");
    if (state.transport.playing !== playBtn.classList.contains("on")) syncTransport();
  });

  /* ---------------------------------------------------------------- viewport HUD */
  const camBtns = CAMS.map(([id, name], i) => btn("", name, () => state.setUI("camera", id), `Kamera ${name} (${i + 1})`));
  const tg = (key, label, title) => btn("", label, () => state.setUI(key, !state.ui[key]), title);
  const beamsBtn = tg("beams", "Beams", "Lichtkegel anzeigen");
  const labelsBtn = tg("labels", "Labels", "Fixture-Nummern anzeigen");
  const qualBtn = btn("", "HQ", () => state.setUI("quality", state.ui.quality === "hoch" ? "niedrig" : "hoch"), "Render-Qualität hoch/niedrig");
  const haze = fader({ label: "", value: state.ui.haze, horizontal: true, color: "var(--accent-2)", onInput: (v) => state.setUI("haze", v) });
  haze.el.title = "Dunst";
  $("#viewport-hud").append(h("div.hud-group", camBtns), h("div.hud-group.hud-right", beamsBtn, labelsBtn, qualBtn, h("span.hint", { style: "align-self:center;padding:0 2px 0 6px" }, "Dunst"), haze.el));
  const syncHud = () => {
    CAMS.forEach(([id], i) => camBtns[i].classList.toggle("on", state.ui.camera === id));
    beamsBtn.classList.toggle("on", !!state.ui.beams);
    labelsBtn.classList.toggle("on", !!state.ui.labels);
    qualBtn.classList.toggle("on", state.ui.quality === "hoch");
    haze.set(state.ui.haze);
  };
  state.on("ui:changed", syncHud);
  syncHud();

  /* ---------------------------------------------------------------- tabs */
  const tabBtns = TABS.map(([id, label, short, mobile]) => h(`button.tab${mobile ? ".mobile-only" : ""}`, { type: "button", dataset: { tab: id }, onclick: () => setTab(id) },
    h("span.t-long", label), h("span.t-short", short || label)));
  $("#side-tabs").append(...tabBtns);
  let activeTab = "programmer";
  function setTab(id) {
    activeTab = id;
    tabBtns.forEach((b) => b.classList.toggle("active", b.dataset.tab === id));
    document.querySelectorAll("#sidebar .panel").forEach((p) => p.classList.toggle("active", p.id === `panel-${id}`));
    document.body.dataset.tab = id;
    try { localStorage.setItem("lumen.tab", id); } catch (e) { /* ignore */ }
    if (id === "dmx") drawDmx(engine?.frame);
  }
  let saved = null;
  try { saved = localStorage.getItem("lumen.tab"); } catch (e) { /* ignore */ }
  setTab(TABS.some(([id]) => id === saved) && saved !== "timeline" ? saved : "programmer");

  /* ---------------------------------------------------------------- patch */
  const patchRoot = $("#panel-patch");
  const typeSel = h("select.grow", TYPE_KEYS.map((k) => h("option", { value: k, title: `${getType(k).footprint} Kanäle` }, getType(k).name)));
  const countIn = h("input", { type: "number", min: 1, max: 48, value: 1, style: "width:50px", title: "Anzahl", onkeydown: (e) => e.stopPropagation() });
  const univIn = h("input", { type: "number", min: 1, max: 16, value: 1, style: "width:46px", title: "Universe", onkeydown: (e) => e.stopPropagation() });
  const conflictBox = h("div");
  const patchBody = h("tbody");
  const patchInfo = h("span.hint.grow");
  const delBtn = btn("small danger", [icon("trash"), "Auswahl löschen"], () => {
    const ids = state.programmer.selection;
    if (ids.length) state.removeFixtures(ids);
  });
  const addFx = () => {
    const type = typeSel.value, d = getType(type), n = clamp(parseInt(countIn.value) || 1, 1, 48), u = clamp(parseInt(univIn.value) || 1, 1, 16);
    const hang = d.category === "mover" || d.category === "strobe";
    const added = state.addFixtures(type, n, { universe: u, pos: hang ? [0, 7.72, 3.2] : [0, 1.3, 2.4], spacing: 1.2, mount: hang ? "hang" : "floor" });
    state.select(added.map((f) => f.id));
    state.status(`${n}× ${d.name} gepatcht (U${u}.${added[0].address})`, "ok");
  };
  patchRoot.append(h("div.panel-pad",
    h("div.row.nowrap", typeSel, h("span.hint", "×"), countIn, h("span.hint", "U"), univIn, btn("primary", [icon("plus"), "Patch"], addFx, "Fixtures hinzufügen (nächste freie Adresse)")),
    conflictBox,
    h("div.row", patchInfo, delBtn)),
  h("div.tbl-wrap", h("table.tbl", h("thead", h("tr", ["FID", "Name", "Typ", "U", "Adresse", "Ch"].map((t) => h("th", t)))), patchBody)));

  function renderPatch() {
    const conf = state.addressConflicts();
    const bad = new Set(conf.flatMap((c) => [c.a, c.b]).filter(Boolean));
    conflictBox.replaceChildren(conf.length
      ? h("div.alert.error.row", h("span.grow", `${conf.length} Adresskonflikt${conf.length > 1 ? "e" : ""}: `, conf.slice(0, 3).map((c) =>
        `${state.fixture(c.a)?.name}${c.b ? " ↔ " + state.fixture(c.b)?.name : " (außerhalb 1–512)"}`).join(", "), conf.length > 3 ? " …" : ""),
        btn("small", "Neu adressieren", fixConflicts))
      : h("div.alert.ok", `${state.show.fixtures.length} Fixtures · keine Adresskonflikte`));
    const sel = new Set(state.programmer.selection);
    patchBody.replaceChildren(...[...state.show.fixtures].sort((a, b) => a.fid - b.fid).map((f) => {
      const d = getType(f.type);
      const tr = h("tr", { dataset: { id: f.id }, class: (sel.has(f.id) ? "sel " : "") + (bad.has(f.id) ? "conflict" : ""),
        onclick: (e) => state.select([f.id], e.shiftKey || e.metaKey || e.ctrlKey ? "toggle" : "set") });
      const num = (key, label, min, max) => h("td.edit.mono.num" + (key === "address" ? ".addr" : ""), {
        title: `${label} ändern (Doppelklick)`,
        ondblclick: (e) => promptValue(e.currentTarget, f[key], (v) => {
          v = Math.round(v);
          if (v < min || v > max) return state.status(`${label} muss zwischen ${min} und ${max} liegen`, "warn");
          if (key === "fid" && state.show.fixtures.some((x) => x.fid === v && x.id !== f.id)) return state.status(`FID ${v} ist schon vergeben`, "warn");
          state.updateFixture(f.id, { [key]: v }, { label: `${label} ${f.name}` });
        }),
      }, String(f[key]));
      tr.append(num("fid", "FID", 1, 99999),
        h("td.edit", { title: "Umbenennen (Doppelklick)", ondblclick: (e) => editText(e.currentTarget, f.name, (v) => state.updateFixture(f.id, { name: v }, { label: "Fixture umbenennen" })) }, f.name),
        h("td", { title: d?.name }, h("span.type-badge", d?.short || f.type)),
        num("universe", "Universe", 1, 16), num("address", "Adresse", 1, 512),
        h("td.mono.num.muted", String(d?.footprint || 0)));
      return tr;
    }));
    syncPatchSel();
  }
  function syncPatchSel() {
    const sel = new Set(state.programmer.selection);
    for (const tr of patchBody.children) tr.classList.toggle("sel", sel.has(tr.dataset.id));
    setText(patchInfo, sel.size ? `${sel.size} ausgewählt` : "Klick = auswählen · Doppelklick = bearbeiten");
    delBtn.disabled = !sel.size;
  }
  function fixConflicts() {
    const conf = state.addressConflicts();
    const move = [...new Set(conf.map((c) => c.b || c.a))];
    state.mutate("Konflikte neu adressieren", (show) => {
      for (const id of move) {
        const f = show.fixtures.find((x) => x.id === id);
        const a = state.nextFreeAddress(f.universe, getType(f.type).footprint, [id]);
        if (a) f.address = a;
      }
    }, { scope: "patch" });
    state.status(`${move.length} Fixture(s) neu adressiert`, "ok");
  }

  /* ---------------------------------------------------------------- groups & presets */
  const libRoot = $("#panel-library");
  const grpSec = section("Gruppen", { color: "var(--sel)", tools: btn("small", [icon("plus"), "Aus Auswahl"], () => {
    if (!state.programmer.selection.length) return state.status("Erst Fixtures auswählen", "warn");
    const g = state.addGroup(undefined, state.programmer.selection);
    state.status(`Gruppe „${g.name}“ angelegt (${g.fixtures.length} Fixtures)`, "ok");
  }, "Neue Gruppe aus der aktuellen Auswahl") });
  const grpChips = h("div.chips");
  grpSec.body.append(grpChips, h("div.hint", "Klick = auswählen · Shift = hinzufügen · Doppelklick = umbenennen"));
  const presetSecs = Object.keys(KIND_LABEL).map((kind) => {
    const s = section(KIND_LABEL[kind], { color: KIND_COLOR[kind], tools: btn("small", [icon("plus"), "Speichern"], () => {
      const n = state.show.presets.filter((p) => p.kind === kind).length + 1;
      const p = state.storePreset(kind, `${KIND_LABEL[kind].replace(/en$/, "e").replace(/n$/, "")} ${n}`);
      if (p) state.status(`Preset „${p.name}“ gespeichert`, "ok");
    }, "Programmer-Werte als Preset speichern") });
    s.tiles = h("div.tiles");
    s.body.append(s.tiles);
    s.kind = kind;
    return s;
  });
  libRoot.append(grpSec.el, ...presetSecs.map((s) => s.el), h("div.empty", "Presets wirken auf die Auswahl und landen im Programmer."));

  function renderLibrary() {
    grpChips.replaceChildren(...state.show.groups.map((g) => {
      const chip = h("span.chip", { style: `--c:${g.color || "var(--sel)"}`, dataset: { id: g.id }, title: `${g.fixtures.length} Fixtures`,
        onclick: (e) => state.selectGroup(g.id, e.shiftKey ? "add" : "set"),
        ondblclick: (e) => editText(e.currentTarget.querySelector(".gname"), g.name, (v) => state.updateGroup(g.id, { name: v })) },
      h("span.gname", g.name), h("span.muted.mono", String(g.fixtures.length)),
      h("span.x", { title: "Gruppe löschen", onclick: (e) => { e.stopPropagation(); state.removeGroup(g.id); } }, "×"));
      return chip;
    }));
    if (!state.show.groups.length) grpChips.append(h("span.hint", "Noch keine Gruppen."));
    for (const s of presetSecs) {
      const list = state.show.presets.filter((p) => p.kind === s.kind);
      s.tiles.replaceChildren(...list.map((p) => h("div.tile", {
        title: "Klick = auf Auswahl anwenden · Doppelklick = umbenennen",
        onclick: () => {
          if (!state.programmer.selection.length) return state.status("Erst Fixtures auswählen", "warn");
          const n = state.applyPreset(p.id);
          state.status(n ? `„${p.name}“ auf ${n} Fixture(s) angewendet` : `„${p.name}“ passt zu keinem ausgewählten Fixture`, n ? "info" : "warn");
        },
        ondblclick: (e) => editText(e.currentTarget.querySelector(".pname"), p.name, (v) =>
          state.mutate("Preset umbenennen", (show) => { show.presets.find((x) => x.id === p.id).name = v; }, { scope: "presets" })),
      }, p.color ? h("span.tile-col", { style: `background:${p.color}` }) : null, h("span.pname", p.name),
      h("span.x", { title: "Preset löschen", onclick: (e) => { e.stopPropagation(); state.removePreset(p.id); } }, "×"))));
      if (!list.length) s.tiles.append(h("span.hint", "Keine Presets."));
    }
    syncGroupSel();
  }
  function syncGroupSel() {
    const sel = new Set(state.programmer.selection);
    for (const chip of grpChips.children) {
      const g = state.group(chip.dataset?.id);
      if (!g) continue;
      const n = g.fixtures.filter((id) => sel.has(id)).length;
      chip.classList.toggle("on", n > 0 && n === g.fixtures.length);
      chip.classList.toggle("part", n > 0 && n < g.fixtures.length);
    }
  }

  /* ---------------------------------------------------------------- DMX monitor */
  const dmxRoot = $("#panel-dmx");
  let dmxU = 1, dmxHover = -1;
  const univSegWrap = h("div");
  const dmxCanvas = h("canvas.dmx-canvas");
  const dmxInfo = h("div.dmx-info", "Maus über einen Kanal bewegen …");
  dmxRoot.append(h("div.panel-pad", h("div.row", h("span.hint", "Universe"), univSegWrap, h("span.hint.grow", { style: "text-align:right" }, "nur Monitor, kein Netzwerk-Ausgang")), dmxCanvas, dmxInfo));
  function renderUniverses() {
    const us = [...new Set([1, ...state.show.fixtures.map((f) => f.universe)])].sort((a, b) => a - b);
    if (!us.includes(dmxU)) dmxU = us[0];
    univSegWrap.replaceChildren(segmented(us.map((u) => ({ value: u, label: `U${u}` })), dmxU, (u) => { dmxU = u; drawDmx(engine?.frame); }).el);
  }
  const dmxCols = () => (dmxCanvas.clientWidth >= 560 ? 32 : 16);
  function dmxOwners() {
    const own = new Int16Array(513).fill(-1);
    state.show.fixtures.forEach((f, i) => {
      if (f.universe !== dmxU) return;
      const n = getType(f.type)?.footprint || 0;
      for (let k = 0; k < n && f.address + k <= 512; k++) own[f.address + k] = i;
    });
    return own;
  }
  let owners = null;
  function drawDmx(frame) {
    if (activeTab !== "dmx" || !dmxCanvas.isConnected) return;
    const w = dmxCanvas.clientWidth;
    if (!w) return;
    owners ||= dmxOwners();
    const cols = dmxCols(), rows = 512 / cols, cw = w / cols, ch = Math.max(18, Math.round(cw * 0.8)), H = rows * ch;
    const dpr = Math.min(2, devicePixelRatio || 1);
    if (dmxCanvas.height !== Math.round(H * dpr) || dmxCanvas.width !== Math.round(w * dpr)) {
      dmxCanvas.width = Math.round(w * dpr);
      dmxCanvas.height = Math.round(H * dpr);
      dmxCanvas.style.height = `${H}px`;
    }
    const g = dmxCanvas.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, H);
    const buf = frame?.dmx?.[dmxU];
    g.font = `${cw > 26 ? 10 : 9}px ui-monospace, Menlo, monospace`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    for (let i = 0; i < 512; i++) {
      const x = (i % cols) * cw, y = Math.floor(i / cols) * ch, o = owners[i + 1], v = buf ? buf[i] : 0;
      g.fillStyle = o < 0 ? "#0b0d10" : o % 2 ? "#18202b" : "#1d1a25";
      g.fillRect(x + 0.5, y + 0.5, cw - 1, ch - 1);
      if (v) {
        g.fillStyle = `rgba(255,176,0,${0.25 + (v / 255) * 0.55})`;
        const bh = (ch - 1) * (v / 255);
        g.fillRect(x + 0.5, y + ch - 0.5 - bh, cw - 1, bh);
      }
      if (o >= 0 && owners[i] !== o) { g.fillStyle = "#3ec5ff"; g.fillRect(x + 0.5, y + 0.5, 2, ch - 1); }
      g.fillStyle = v ? "#e6edf5" : o >= 0 ? "#4a5462" : "#262c37";
      g.fillText(v ? String(v) : String(i + 1), x + cw / 2, y + ch / 2 + 0.5);
      if (i === dmxHover) { g.strokeStyle = "#fff"; g.strokeRect(x + 1, y + 1, cw - 2, ch - 2); }
    }
    if (dmxHover >= 0) {
      const hit = channelAt(state.show.fixtures, dmxU, dmxHover + 1), v = buf ? buf[dmxHover] : 0;
      dmxInfo.replaceChildren(h("b.mono", `U${dmxU}.${dmxHover + 1}`), " · ",
        hit ? h("span", h("b", hit.fixture.name), ` (FID ${hit.fixture.fid}) · Kanal ${hit.index + 1}/${getType(hit.fixture.type).footprint} `, h("b", channelLabel(hit.channel))) : "frei",
        " · ", h("b.mono", `${v}`), ` (${Math.round((v / 255) * 100)} %)`);
    }
  }
  dmxCanvas.addEventListener("pointermove", (e) => {
    const r = dmxCanvas.getBoundingClientRect(), cols = dmxCols(), cw = r.width / cols, ch = r.height / (512 / cols);
    const i = Math.floor((e.clientY - r.top) / ch) * cols + Math.floor((e.clientX - r.left) / cw);
    dmxHover = i >= 0 && i < 512 ? i : -1;
    drawDmx(engine?.frame);
  });
  dmxCanvas.addEventListener("pointerleave", () => { dmxHover = -1; drawDmx(engine?.frame); });
  dmxCanvas.addEventListener("click", () => {
    const hit = dmxHover >= 0 && channelAt(state.show.fixtures, dmxU, dmxHover + 1);
    if (hit) state.select([hit.fixture.id]);
  });
  ticks.push(drawDmx);

  /* ---------------------------------------------------------------- show tab */
  const showRoot = $("#panel-show");
  const nameIn = h("input", { type: "text", onchange: () => {
    const v = nameIn.value.trim();
    if (v && v !== state.show.name) state.mutate("Show umbenennen", (s) => { s.name = v; }, { scope: "all" });
  }, onkeydown: (e) => { e.stopPropagation(); if (e.key === "Enter") nameIn.blur(); } });
  const showStats = h("div.hint");
  const fileSec = section("Show", { color: "var(--accent)" });
  fileSec.body.append(h("label.field", "Name", nameIn), showStats,
    h("div.grid2",
      btn("", [icon("save"), "Speichern"], save, "Im Browser speichern (Autosave ist aktiv)"),
      btn("", [icon("download"), "Export JSON"], exportShow),
      btn("", [icon("upload"), "Import JSON"], pickShow),
      btn("", "Demo laden", loadDemo, "Demo-Show „Drum Show“ laden (rückgängig machbar)"),
      btn("", "Neue Show", newShow, "Standard-Rigg ohne Cues"),
      btn("danger", "Lokalen Speicher leeren", () => { state.clearLocal(); state.status("Lokaler Speicher geleert", "ok"); })));
  const audioInfo = h("div.hint");
  const clickToggle = h("input", { type: "checkbox", onchange: () => { if (audio) { audio.click = clickToggle.checked; clickBtn.classList.toggle("on", audio.click); } } });
  const vol = fader({ label: "Lautstärke", value: audio?.volume ?? 1, horizontal: true, color: "var(--accent-2)", onInput: (v) => { if (audio) audio.volume = v; } });
  const audioSec = section("Audio", { color: "var(--accent-2)" });
  audioSec.body.append(audioInfo, h("div.row", btn("", [icon("music"), "Song laden"], pickAudio), h("label.row.hint", clickToggle, "Beat-Klick")), vol.el,
    h("div.hint", "Der Song ist nicht Teil der Veröffentlichung. MP3 per Button oder Drag & Drop laden – ohne Song läuft ein synthetischer Klick aus dem Beat-Grid."));
  const fadeIn = h("input", { type: "number", min: 0, max: 30, step: 0.1, style: "width:70px", onchange: () => {
    const v = clamp(parseFloat(fadeIn.value) || 0, 0, 30);
    state.mutate("Standard-Fade", (s) => { s.settings.fadeDefault = v; }, { scope: "all" });
  }, onkeydown: (e) => e.stopPropagation() });
  const snapCb = h("input", { type: "checkbox", onchange: () => state.setUI("snap", snapCb.checked) });
  const followCb = h("input", { type: "checkbox", onchange: () => state.setUI("follow", followCb.checked) });
  const setSec = section("Einstellungen", { color: "var(--text-3)" });
  setSec.body.append(h("label.row.hint", "Standard-Fade (s)", fadeIn), h("label.row.hint", snapCb, "Cues auf Beats einrasten"), h("label.row.hint", followCb, "Timeline folgt dem Playhead"));
  const keys = [["Leertaste", "Play/Pause"], ["Pos1", "Zum Anfang"], ["← →", "±1 Beat (Shift: Takt)"], ["Strg+Z / Strg+Y", "Rückgängig / Wiederholen"],
    ["Strg+S", "Speichern"], ["Esc", "Programmer leeren"], ["1–6", "Kameras"], ["B S W L F X", "Executoren"], ["Entf", "Cue löschen"], ["Strg+Mausrad", "Timeline-Zoom"]];
  const keySec = section("Tastenkürzel", { collapsible: true, color: "var(--text-3)" });
  keySec.body.append(...keys.map(([k, v]) => h("div.row.nowrap.hint", h("kbd", k), h("span", v))));
  showRoot.append(fileSec.el, audioSec.el, setSec.el, keySec.el);
  function renderShowTab() {
    if (document.activeElement !== nameIn) nameIn.value = state.show.name || "";
    const s = state.show;
    showStats.textContent = `${s.fixtures.length} Fixtures · ${s.groups.length} Gruppen · ${s.presets.length} Presets · ${s.cues.length} Cues · ${de(s.audio.bpm || 0, 1)} BPM · ${fmtTime(s.audio.duration || 0, 0)}`;
    if (document.activeElement !== fadeIn) fadeIn.value = s.settings.fadeDefault ?? 1;
    snapCb.checked = !!state.ui.snap;
    followCb.checked = !!state.ui.follow;
    setText(showName, s.name || "");
  }
  const SRC = { url: "Song (lokale MP3)", file: "Song (geladene Datei)", synth: "Synth-Klick (kein Song geladen)" };
  function syncAudio(e = {}) {
    const src = audio?.source;
    audioInfo.textContent = `Quelle: ${SRC[src] || "–"}${e.name ? ` · ${e.name}` : ""}`;
    clickToggle.checked = !!audio?.click;
    if (audio) vol.set(audio.volume ?? 1);
  }
  state.on("audio:loaded", syncAudio);
  state.on("ui:changed", (e) => { if (e.key === "snap" || e.key === "follow") renderShowTab(); });

  /* ---------------------------------------------------------------- executors */
  const execRoot = $("#executors");
  function renderExecutors() {
    execRoot.replaceChildren(h("div.exec-label", "Executor"), ...state.show.executors.map((x) => {
      const el = h("div.exec", { style: `--c:${x.color || "var(--accent)"}`, dataset: { id: x.id }, title: `${x.name} – ${x.mode === "toggle" ? "Toggle" : "Flash"} (Taste ${x.key?.toUpperCase()})` },
        h("div.exec-name", x.name), h("div.exec-meta", h("span", x.mode === "toggle" ? "TOGGLE" : "FLASH"), x.key ? h("kbd", x.key.toUpperCase()) : null));
      el.classList.toggle("active", !!state.live.executors[x.id]?.active);
      el.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        if (x.mode === "toggle") return state.toggleExecutor(x.id);
        try { el.setPointerCapture(e.pointerId); } catch (err) { /* synthetic */ }
        state.setExecutor(x.id, true);
      });
      const off = () => { if (x.mode !== "toggle") state.setExecutor(x.id, false); };
      el.addEventListener("pointerup", off);
      el.addEventListener("pointercancel", off);
      return el;
    }));
  }
  state.on("live:changed", (e) => {
    if (e.key !== "executor") return;
    execRoot.querySelector(`.exec[data-id="${e.id}"]`)?.classList.toggle("active", !!e.active);
  });

  /* ---------------------------------------------------------------- status bar */
  const st = { msg: h("span.st-msg", "Bereit."), sel: h("b"), prog: h("b"), audio: h("b"), saved: h("b", "–") };
  $("#statusbar").append(st.msg, h("span.st-item", "Auswahl ", st.sel), h("span.st-item", "Programmer ", st.prog),
    h("span.st-item.opt", "Audio ", st.audio), h("span.st-item.opt", "Gespeichert ", st.saved));
  let msgTimer = 0;
  state.on("status", ({ text, kind = "info" }) => {
    st.msg.textContent = text;
    st.msg.className = `st-msg ${kind}`;
    clearTimeout(msgTimer);
    msgTimer = setTimeout(() => st.msg.classList.add("fade"), 6000);
  });
  state.on("show:saved", ({ at }) => setText(st.saved, new Date(at).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", second: "2-digit" })));
  ticks.push(() => {
    setText(st.sel, String(state.programmer.selection.length));
    const nv = Object.keys(state.programmer.values).length, ne = state.programmer.effects.length;
    setText(st.prog, nv || ne ? `${nv} Fixtures · ${ne} Effekte` : "leer");
    st.prog.style.color = nv || ne ? "var(--prog)" : "";
    setText(st.audio, { url: "MP3", file: "Datei", synth: "Synth-Klick" }[audio?.source] || "–");
  });

  /* ---------------------------------------------------------------- drag & drop */
  const drop = $("#drop-overlay");
  let dragDepth = 0;
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes("Files");
  window.addEventListener("dragenter", (e) => { if (!hasFiles(e)) return; dragDepth++; drop.hidden = false; });
  window.addEventListener("dragleave", () => { if (--dragDepth <= 0) { dragDepth = 0; drop.hidden = true; } });
  window.addEventListener("dragover", (e) => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener("drop", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    drop.hidden = true;
    [...e.dataTransfer.files].forEach(handleFile);
  });

  /* ---------------------------------------------------------------- start overlay */
  const start = $("#start-overlay");
  if (start) {
    let hasLocal = false;
    try { hasLocal = !!localStorage.getItem(STORAGE_KEY); } catch (e) { /* ignore */ }
    const resume = start.querySelector('[data-start="resume"]');
    if (resume) resume.hidden = !hasLocal;
    const close = () => { start.classList.add("hide"); setTimeout(() => start.remove(), 400); };
    start.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-start]");
      if (!b) return;
      const mode = b.dataset.start;
      close();
      if (mode === "demo" && (await loadDemo())) { audio?.seek(0); audio?.play(); }
      if (mode === "empty") newShow();
    });
    start.addEventListener("keydown", (e) => e.stopPropagation());
  }

  // Delete selected fixtures from the patch tab with Entf (timeline handles cue deletion itself)
  window.addEventListener("keydown", (e) => {
    if (typing(e) || activeTab !== "patch" || (e.key !== "Delete" && e.key !== "Backspace")) return;
    if (state.programmer.selection.length) { e.preventDefault(); e.stopImmediatePropagation(); state.removeFixtures(state.programmer.selection); }
  }, true);

  /* ---------------------------------------------------------------- wiring */
  function renderAll(scope = "all") {
    if (scope === "all" || scope === "patch") { renderPatch(); renderUniverses(); owners = null; }
    if (scope === "all" || scope === "groups" || scope === "presets" || scope === "patch") renderLibrary();
    if (scope === "all") renderExecutors();
    renderShowTab();
  }
  state.on("show:changed", ({ scope }) => renderAll(scope));
  state.on("selection:changed", () => { syncPatchSel(); syncGroupSel(); });
  renderAll();
  syncAudio();
  syncTransport();

  return {
    tick(frame) { if (frame) for (const f of ticks) f(frame); },
    setTab, loadDemo, newShow, exportShow, handleFile,
  };
}
