# Xenon reimagined

An independent redesign of https://preview.xenon.bot/, captured on 2026-09-06.

The homepage preserves the original feature descriptions, stats, featured templates, topic links, FAQs, plan details, and footer destinations. Product, authentication, invitation, template, and documentation links go to the existing Xenon services. The restore and scheduling panels are labeled examples; they do not access Discord or create real backups.

## Development

```sh
npm ci
npm run dev
npm run build
```

Copy `dist/` to `../../public/xenon-reimagined/`, then run the repository root `npm run build` to refresh `docs/`. GitHub Pages publishes `main:/docs`.

Interactions: restore replay, command copying, automatic-backup and sync tabs, FAQ disclosures, mobile navigation, language links, and a light/dark theme toggle. The UI supports keyboard focus and reduced motion.
