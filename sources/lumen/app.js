// LUMEN: wires state, engine, audio, viz and UI; owns the single rAF loop and the global shortcuts.
import { createState, applyAnalysis } from "./core/state.js";
import { createEngine } from "./core/engine.js";
import { createAudio } from "./audio.js";
import { createViz, CAMERAS } from "./viz/stage.js";
import { createPanels } from "./ui/panels.js";
import { createProgrammer } from "./ui/programmer.js";
import { createTimeline } from "./ui/timeline.js";
import { createDemoShow } from "./demo/drum-show.js";

const $ = (s) => document.querySelector(s);
const typing = (e) => /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;

async function main() {
  const an = await fetch("./data/drum-show.analysis.json").then((r) => r.json());
  const state = createState();
  state.analysis = an;
  if (!state.loadLocal()) state.load(createDemoShow(an), { label: "Demo", save: false });
  if (!state.show.audio.beats?.length) applyAnalysis(state.show, an);

  const engine = createEngine(state);
  const audio = createAudio(state);
  const viz = createViz($("#viewport"), state);
  const ctx = { state, engine, audio, viz };
  const panels = createPanels(state, ctx);
  const programmer = createProgrammer($("#panel-programmer"), state, ctx);
  const timeline = createTimeline($("#timeline"), state, ctx);
  Object.assign(ctx, { panels, programmer, timeline });
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
    else if (/^[1-6]$/.test(e.key)) state.setUI("camera", CAMERAS[+e.key - 1].id);
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
