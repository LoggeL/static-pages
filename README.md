# Static Pages

A growing collection of ambitious static web experiments and interface studies.

## Published pages

- **[Peel P50 · 3D](https://loggel.github.io/static-pages/peel-p50/)**: a procedural 3D model of the Peel P50 (1962–65), built without any image generation. The body is a signed distance field (rounded extrusions, smooth unions, a raked windscreen plane, wheel wells) meshed with surface nets and Newton-projected onto the iso-surface. Windows, seals and the door seam are 2D distance fields cut into the mesh along exact iso-lines. Wheels with knobbly tread, the single headlight, lamps, trim strips, the rear handle, wiper, mirror and cabin are parametric Three.js parts placed on the body by raymarching. The viewer has orbit controls, factory paints and a GLB download. Source and generator: `sources/peel-p50/`.
- **[Nachhilfe: 90 Minuten, drei Wege](https://loggel.github.io/static-pages/nachhilfe-quadratische-gleichungen/)**: a German 90-minute tutoring plan for quadratic equations (grade 9), matched to the three methods in the student's notebook (completing the square, taking square roots, zero-product property) rather than the learning page's grouping. A sticky lesson timer highlights the current phase; each phase has a goal, word-for-word prompts, exercises with step-by-step solutions to reveal, typical traps and deep links into the learning page. Includes a table of copying errors from the notebook, a quick method-choice round, a mini quiz, a printable worksheet (with or without solutions), a checklist and local notes. Source: `sources/nachhilfe-quadratische-gleichungen/`.

- **[Quadratische Gleichungen: drei Wege, ohne Formel](https://loggel.github.io/static-pages/quadratische-gleichungen/)**: a mobile-first German learning app for a grade-9 quiz (HÜ) on solving quadratic equations without the quadratic formula: graphically (interactive parabola and parabola-meets-line labs), by factoring (zero-product property, factoring out x, square roots, binomial formulas backwards, a sum-product pair finder) and by completing the square (animated area model and a step-by-step solver for your own equation). Every chapter has step-by-step worked examples, typical mistakes and checked exercises that understand inputs like `L = {−3; 2}`, plus a method chooser, a sorting game and an error detective, an endless randomized trainer with generated solutions, two timed practice quizzes with marking schemes, a printable one-page cheat sheet and a tutor's guide for a 90-minute lesson. Source (parts, build script, agent contract, Node tests): `sources/quadratische-gleichungen/`.

- **[LUMEN: Lichtdesign-Studio](https://loggel.github.io/static-pages/lumen/)**: a browser-based lighting design console in the spirit of grandMA3, Capture or WYSIWYG. Patch 83 fixtures across four universes (moving heads, LED PARs, pixel bars, strobes, blinders, seven lasers with fan, tunnel and scan patterns, sparkulars, CO2 jets and flame projectors), build looks in the programmer, store cues, run executors and a beat-synced timeline, and watch beams cut through haze on a live Three.js stage with bloom post-processing, an automatic show camera and onset-precise drum hits on a two-piece band with its live touring band (drum riser with seated drummer, frontman walking between mic and grand piano, plus bass, guitar and synth on podiums; generic low-poly placeholder figures). Ships with a complete demo show for "Drum Show" by Twenty One Pilots, programmed to a signal-verified song map at 164 BPM (structural cue names only). The song is **not** in the repo: put it locally at `public/lumen/audio/drum-show.mp3` (e.g. via `yt-dlp -x --audio-format mp3`; the folder is gitignored) or load it with the "Song laden" file dialog / drag & drop. Without the song, a synthesized beat click from the analysed beat grid keeps the demo running. Master volume and mute sit in the transport bar (`M`). Source: `sources/lumen/` (without `audio/` and `vendor/`).

- **[Haarästhetik · Quelle der Entspannung](https://loggel.github.io/static-pages/haaraesthetik-bernhardt/)**: a second, more refined redesign concept for the hair salon Haarästhetik Christian Bernhardt. A WebGL fountain hero that is first a pencil sketch and then paints itself in pastel watercolour from the spring outwards, with living water and cursor ripples; nine chapters that follow a day in the salon through its light (morning light to night) with colour shifts, a hair-length morph, a Great Lengths magnifier, Hårtræt care cards and a hair-tester lens, a wedding editorial and a vertical salon tour on mobile. Prices adapt to a hair-length switch. AI-generated imagery via Codex. Concept study, not affiliated with the salon. Source (parts, build script, agent contract): `sources/haaraesthetik-bernhardt/`.

- **[Haarästhetik · Die Chroma Edition](https://loggel.github.io/static-pages/haaraesthetik-edition/)**: a futuristic redesign concept for the hair salon Haarästhetik Christian Bernhardt in Kirchheim an der Weinstraße, staged in the style of the Shopify Editions Winter '26. Obsidian black and electric violet, eight numbered chapters (I–VIII), scroll-driven reveals and parallax, a particle ring, and AI-generated imagery. Concept study, not affiliated with the salon. Source: `sources/haaraesthetik-edition/`.

- **[Was der Berg behält: Roman vom Donnersberg](https://loggel.github.io/static-pages/was-der-berg-behaelt/)**: a complete German historical low-fantasy novel (~113,000 words) about the Celtic oppidum on the Donnersberg, 54–51 BC, and why it was abandoned. A glassmaker with a lightning-struck, singing ear, a courteous Etruscan-Roman prefect as antagonist, Gaulish myth (Taranis, the triad of water, tree and fire), magic that is always ambiguous. Built in a reader with part illustrations, table of contents, reading progress, light/ember themes, glossary pop-ups, and an appendix with characters, calendar and an afterword on fact versus fiction. Source (chapters, story bible, chapter plan, research dossiers, build script): `sources/was-der-berg-behaelt/`.

- **[Bildbeschreibung: Schritt für Schritt zum Bilddetektiv](https://loggel.github.io/static-pages/bildbeschreibung-klasse5/)**: a complete German grade-5 teaching unit on picture description. Lesson plan, 13 lessons plus a feedback lesson with word-for-word teacher prompts, 18 printable A4 worksheets with solutions, a poster and word bank, 12 homework tasks with varied checks and short tests, a 35-method kit, ten interactive learning games with a printable diploma, a projector mode (grid, zones, magnifier, Kim-game timer) and a class test with marking scheme. Nine consistent picture-book illustrations (incl. a spot-the-difference pair and a hidden-object picture) generated with Codex image generation. Source: `sources/bildbeschreibung-klasse5/`.

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
- Quadratische Gleichungen learning app: <https://loggel.github.io/static-pages/quadratische-gleichungen/>
- LUMEN lighting design studio: <https://loggel.github.io/static-pages/lumen/>
- Haarästhetik · Quelle der Entspannung (redesign concept): <https://loggel.github.io/static-pages/haaraesthetik-bernhardt/>
- Haarästhetik Chroma Edition (redesign concept): <https://loggel.github.io/static-pages/haaraesthetik-edition/>
- Was der Berg behält (novel): <https://loggel.github.io/static-pages/was-der-berg-behaelt/>
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
