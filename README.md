# Static Pages

A growing collection of ambitious static web experiments and interface studies.

## Published pages

1. **[Spiel. Bewegung. Haltung.](https://loggel.github.io/static-pages/bewegungserziehung-uw1/)** — a deliberately maximalist, source-labeled lesson report about movement education.
2. **[ShareX — The Capture Engine](https://github.com/LoggeL/sharex-capture-engine)** — a cinematic Three.js redesign of the ShareX website.
3. **[ShareX — Afterimage Lab](https://github.com/LoggeL/sharex-afterimage-lab)** — a bio-digital editorial redesign featuring original imagegen artwork.
4. **[ShareX — Windows 98 Edition](https://github.com/LoggeL/sharex-win98)** — a full interactive desktop simulation with draggable windows, capture workflows, upload queues, and responsive pocket mode.

Each experiment now lives in its own repository and has an independent GitHub Pages deployment. This repository contains the collection gallery plus redirects for the original design URLs.

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

## Live site

- Gallery: <https://loggel.github.io/static-pages/>
- Bewegungserziehung lesson report: <https://loggel.github.io/static-pages/bewegungserziehung-uw1/>
- ShareX redesign: <https://loggel.github.io/sharex-capture-engine/>
- ShareX Afterimage Lab: <https://loggel.github.io/sharex-afterimage-lab/>
- ShareX Windows 98 Edition: <https://loggel.github.io/sharex-win98/>
