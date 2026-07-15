# Static Pages

A growing collection of ambitious static web experiments and interface studies.

## Published pages

1. **ShareX — The Capture Engine** — a cinematic Three.js redesign of the ShareX website.

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
