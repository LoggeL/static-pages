// LUMEN: wires state, engine, audio, viz and UI; owns the single rAF loop and the global shortcuts.
import { createState, applyAnalysis } from "./core/state.js";
import { createEngine } from "./core/engine.js";
import { createAudio } from "./audio.js";
import { createViz, CAMERAS } from "./viz/stage.js";
import { createPanels, btn } from "./ui/panels.js";
import { createProgrammer } from "./ui/programmer.js";
import { createTimeline } from "./ui/timeline.js";
import { createDemoShow } from "./demo/drum-show.js";

const $ = (s) => document.querySelector(s);
// a focused range slider (volume) is not "typing": it keeps its own arrow/Home/End keys, other shortcuts still work
const typing = (e) => /^(TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable
  || (e.target.tagName === "INPUT" && (e.target.type !== "range" || /^(Arrow|Home|End|Page)/.test(e.key)));

async function main() {
  const an = await fetch("./data/drum-show.analysis.json").then((r) => r.json());
  const state = createState();
  state.analysis = an;
  if (!state.loadLocal()) state.load(createDemoShow(an), { label: "Demo", save: false });
  if (!state.show.audio.beats?.length) applyAnalysis(state.show, an);
  // white-out overlay (full-screen strobe flash): off by default with prefers-reduced-motion, choice remembered
  let flashPref = null;
  try { flashPref = localStorage.getItem("lumen.flash"); } catch (e) { /* ignore */ }
  state.ui.flash = flashPref ? flashPref === "1" : !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  // shows with camera direction open on the show camera until the user picks a view
  let camPicked = false;
  const hasCamCues = () => state.show.cues.some((c) => c.camera);
  if (hasCamCues()) state.ui.camera = "auto";

  const engine = createEngine(state);
  const audio = createAudio(state);
  const viz = createViz($("#viewport"), state);
  const ctx = { state, engine, audio, viz };
  const panels = createPanels(state, ctx);
  const programmer = createProgrammer($("#panel-programmer"), state, ctx);
  const timeline = createTimeline($("#timeline"), state, ctx);
  Object.assign(ctx, { panels, programmer, timeline });

  /* ---- view toggles: show camera (cuts per section / cue.camera) and bloom */
  const showCamBtn = btn("", "Show-Kamera", () => state.setUI("camera", state.ui.camera === "auto" ? "foh" : "auto"), "Automatische Show-Kamera: Schnitte pro Abschnitt und Cue (7)");
  const bloomBtn = btn("", "Bloom", () => state.setUI("bloom", state.ui.bloom === false), "Bloom/Glow-Nachbearbeitung (nur bei HQ)");
  const flashBtn = btn("", "Blitz-Overlay", () => {
    state.setUI("flash", state.ui.flash === false);
    try { localStorage.setItem("lumen.flash", state.ui.flash === false ? "0" : "1"); } catch (e) { /* ignore */ }
  }, "Vollbild-Aufhellung bei Strobe/Blinder (Strobes auf der Bühne blitzen immer)");
  $("#viewport-hud .hud-right")?.prepend(showCamBtn, bloomBtn, flashBtn);
  const syncView = () => {
    showCamBtn.classList.toggle("on", state.ui.camera === "auto");
    bloomBtn.classList.toggle("on", state.ui.bloom !== false);
    flashBtn.classList.toggle("on", state.ui.flash !== false);
  };
  state.on("ui:changed", ({ key, auto }) => { if (key === "camera" && !auto) camPicked = true; syncView(); });
  // a newly loaded show with camera cues (demo, import, resume) switches to the show camera unless a view was picked;
  // one without (Leere Show, plain import) falls back to FOH, so the auto pool does not cut through an undirected show
  state.on("show:changed", ({ scope }) => {
    if ((scope !== "all" && scope) || camPicked) return;
    const cams = hasCamCues();
    if (cams && state.ui.camera !== "auto") state.setUI("camera", "auto", { auto: true });
    else if (!cams && state.ui.camera === "auto") state.setUI("camera", "foh", { auto: true });
  });
  syncView();
  // the demo always starts with the show camera
  document.querySelector('[data-start="demo"]')?.addEventListener("click", () => state.setUI("camera", "auto", { auto: true }));
  window.lumen = { ...ctx, version: "1" };

  /* ---- loop: audio clock → engine → viz/timeline, panels throttled to 10 Hz */
  let last = performance.now(), lastUi = 0;
  function loop(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const t = audio.time();
    state.transport.t = t;
    const frame = engine.evaluate(t);
    viz.render(frame, dt);
    timeline.draw(t);
    if (now - lastUi > 100) {
      lastUi = now;
      panels.tick(frame);
      programmer.tick(frame);
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  /* ---- global shortcuts */
  const stepBeats = (n) => {
    const t = audio.time(), b = state.beatAt(t);
    audio.seek(state.timeAtBeat(n > 0 ? Math.floor(b + 1e-3) + n : Math.ceil(b - 1e-3) + n));
  };
  const execByKey = (k) => state.show.executors.find((x) => x.key && x.key.toLowerCase() === k);
  window.addEventListener("keydown", (e) => {
    if (typing(e) || e.altKey) return;
    const k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
    if (mod) {
      if (k === "z" && !e.shiftKey) state.undo();
      else if (k === "y" || (k === "z" && e.shiftKey)) state.redo();
      else if (k === "s") { const ok = state.saveLocal(); state.status(ok ? "Show im Browser gespeichert" : "Speichern nicht möglich", ok ? "ok" : "warn"); }
      else return;
      return e.preventDefault();
    }
    if (e.key === " ") { if (!e.repeat) audio.toggle(); }
    else if (e.key === "Home") audio.seek(0);
    else if (e.key === "ArrowLeft" || e.key === "ArrowRight") stepBeats((e.key === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? state.show.audio.beatsPerBar || 4 : 1));
    else if (e.key === "Escape") state.clearProgrammer();
    else if (/^[1-7]$/.test(e.key)) state.setUI("camera", CAMERAS[+e.key - 1].id);
    else if (k === "m" && !execByKey(k)) { if (!e.repeat) panels.toggleMute(); } // an executor bound to M wins
    else {
      const x = execByKey(k);
      if (!x) return;
      if (!e.repeat) x.mode === "toggle" ? state.toggleExecutor(x.id) : state.setExecutor(x.id, true);
    }
    e.preventDefault();
  });
  window.addEventListener("keyup", (e) => {
    const x = execByKey(e.key.toLowerCase());
    if (x && x.mode !== "toggle") state.setExecutor(x.id, false);
  });

  await audio.init();
}

main().catch((e) => {
  console.error(e);
  const s = document.querySelector("#statusbar");
  if (s) s.textContent = `Fehler beim Start: ${e.message}`;
});
