# Static Pages

A growing collection of ambitious static web experiments and interface studies.

## Published pages

1. **ShareX — The Capture Engine** — a cinematic Three.js redesign of the ShareX website.
2. **ShareX — Afterimage Lab** — a bio-digital editorial redesign featuring original imagegen artwork.
3. **ShareX — Windows 98 Edition** — a full interactive desktop simulation with draggable windows, capture workflows, upload queues, and responsive pocket mode.

## Local development

```bash
npm install
npm run dev
```

Build the committed GitHub Pages artifact into `docs/`:

```bash
npm run build
```

The project is a Vite multi-page app. Every experiment gets its own directory under `designs/` and an explicit build entry in `vite.config.js`.

## Live site

- Gallery: <https://loggel.github.io/static-pages/>
- ShareX redesign: <https://loggel.github.io/static-pages/designs/sharex/>
- ShareX Afterimage Lab: <https://loggel.github.io/static-pages/designs/sharex-afterimage/>
- ShareX Windows 98 Edition: <https://loggel.github.io/static-pages/designs/sharex-win98/>
