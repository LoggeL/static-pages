# Static Pages

A growing collection of ambitious static web experiments and interface studies.

## Published pages

- **[Bildbeschreibung: Schritt für Schritt zum Bilddetektiv](https://loggel.github.io/static-pages/bildbeschreibung-klasse5/)**: a complete German grade-5 teaching unit on picture description. Lesson plan, 13 lessons plus a feedback lesson with word-for-word teacher prompts, 18 printable A4 worksheets with solutions, a poster and word bank, 12 homework tasks with varied checks and short tests, a 35-method kit, ten interactive learning games with a printable diploma, a projector mode (grid, zones, magnifier, Kim-game timer) and a class test with marking scheme. Own SVG illustrations plus public-domain paintings by Bruegel and Spitzweg. Source: `sources/bildbeschreibung-klasse5/`.

- **[DOPAMIN: Eine Nacht auf Koks](https://loggel.github.io/static-pages/dopamin/)**: the cocaine counterpart to SEROTONIN. Drag a rolled note along the line, then live through five acts (the line, the kick, king of the world, the spiral, the crash) driven by a small pharmacokinetic model: every line is a bolus, acute tolerance shrinks each high while pulse and blood pressure keep stacking. Recurring "one more line?" decisions (including calling the dealer), a crystal-shard WebGL shader, generative tech-house, paranoid crowds that turn to stare, alcohol and cocaethylene, nosebleeds, extrasystoles, regrettable voice messages, and a Sunday recap with per-line highs and safer-use info. Art/education project, no endorsement. Source: `sources/dopamin/`.

- **[SEROTONIN: Eine Nacht auf XTC](https://loggel.github.io/static-pages/serotonin/)**: an interactive, audiovisual night on ecstasy — without ecstasy. Swallow the pill, then live through six acts (wait, come-up, peak, plateau, comedown, Tuesday) with a WebGL kaleidoscope shader, lasers and a dancing crowd, generative Web Audio techno that follows your body, a live body HUD (pulse, temperature, hydration, jaw, pupils, serotonin tank), synapse and brain illustrations, a redose decision, and a recap of your own night plus safer-use info. Art/education project, no endorsement. Source: `sources/serotonin/`.

- **[Lino Heardle: Erkenne den Song](https://loggel.github.io/static-pages/lino-heardle/)**: a Heardle-style daily music quiz — 5 Lostboi Lino songs a day, starting from a 0.1-second snippet that grows with every skip or wrong guess. Source: `sources/lino-heardle/`; audio lives in `public/lino-heardle/audio/` (Deezer 30s previews).

- **[Veil: Face redaction that never uploads](https://loggel.github.io/static-pages/veil/)**: a browser-only face-censoring studio. Two BlazeFace models run on-device via WASM to find faces, which can then be blurred, mosaicked, inked out or glyph-covered and exported at full resolution — metered at one credit per redacted face, with a working (test-mode) checkout, ledger and export library. Source: `sources/veil/`.

- **[RECTIFY 2: Trennkolonnen-Simulator](https://loggel.github.io/static-pages/rectify-trennkolonne/)**: a dynamic distillation lab with six real fluids, NRTL, coupled energy and material balances, variable liquid inventories, eight scenarios, PI control, and local export. Includes a German guide to assumptions, sources, and validation. Source and test instructions: `sources/rectify-trennkolonne/README.md`.

- **[Xenon: Your server. Your rules.](https://loggel.github.io/static-pages/xenon-reimagined/)**: an interactive redesign with a restore demo, copyable commands, feature tabs, community templates, FAQs, and dark/light themes. Source: `sources/xenon-reimagined/`.

- **[ShareX: Capture without limits](https://loggel.github.io/static-pages/sharex-capture-reimagined/)**: an interactive capture playground with real-time 3D, original ShareX branding, region selection, callouts, and PNG export. Source: `sources/sharex-capture-reimagined/`.

1. **[Creepshow — Probenplan](https://loggel.github.io/static-pages/theater-probenplan-prototyp/)** — a clickable rehearsal, attendance, and calendar prototype for Kolpingtheater Ramsen.
2. **[Spiel. Bewegung. Haltung.](https://loggel.github.io/static-pages/bewegungserziehung-uw1/)** — a deliberately maximalist, source-labeled lesson report about movement education.
3. **[ShareX — The Capture Engine](https://github.com/LoggeL/sharex-capture-engine)** — a cinematic Three.js redesign of the ShareX website.
4. **[ShareX — Afterimage Lab](https://github.com/LoggeL/sharex-afterimage-lab)** — a bio-digital editorial redesign featuring original imagegen artwork.
5. **[ShareX — Windows 98 Edition](https://github.com/LoggeL/sharex-win98)** — a full interactive desktop simulation with draggable windows, capture workflows, upload queues, and responsive pocket mode.

The collection combines pages hosted in this repository with links to experiments in independent repositories. Editable sources for locally hosted pages live under `sources/`; their static exports are published through `public/` and `docs/`.

## Local development

```bash
npm install
npm run dev
```

Build the committed GitHub Pages artifact into `docs/`:

```bash
npm run build
```

The project is a small Vite gallery. Its production artifact is committed to `docs/` for GitHub Pages.
The editable source for the Creepshow rehearsal planner lives in
`sources/theater-probenplan-prototyp/`; its static export is published below the matching folder in `public/` and `docs/`.

## Live site

- Gallery: <https://loggel.github.io/static-pages/>
- Bildbeschreibung teaching unit: <https://loggel.github.io/static-pages/bildbeschreibung-klasse5/>
- DOPAMIN night simulation: <https://loggel.github.io/static-pages/dopamin/>
- SEROTONIN night simulation: <https://loggel.github.io/static-pages/serotonin/>
- Veil face redaction studio: <https://loggel.github.io/static-pages/veil/>
- RECTIFY distillation column simulator: <https://loggel.github.io/static-pages/rectify-trennkolonne/>
- Creepshow rehearsal planner: <https://loggel.github.io/static-pages/theater-probenplan-prototyp/>
- Bewegungserziehung lesson report: <https://loggel.github.io/static-pages/bewegungserziehung-uw1/>
- ShareX redesign: <https://loggel.github.io/sharex-capture-engine/>
- ShareX Afterimage Lab: <https://loggel.github.io/sharex-afterimage-lab/>
- ShareX Windows 98 Edition: <https://loggel.github.io/sharex-win98/>
