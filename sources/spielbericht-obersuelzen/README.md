# SV 1970 Obersülzen · Interaktiver Spiel- & Spielerbericht

Eigenständiger HTML-Scoutingbericht zum Auswärtssieg von **SV 1970 Obersülzen** beim **SV 1920 Horchheim (1:2, 08.11.2026)** in der Bezirksliga Rheinhessen.

## Aufbau & Build

- `sources/spielbericht-obersuelzen/index.html`: Eigenständige HTML-Quelle (Tailwind CDN + `:root` / `html[data-theme="light"]` CSS-Variablen, interaktives 2D-Spielfeld, Einzelnoten für alle 12 beobachteten Spieler, `<canvas>`-Phasenverlauf, 4 SVG-Taktiktafeln, filterbares Ereignisprotokoll, Trainingsplan).
- `public/spielbericht-obersuelzen/index.html`: Statische Veröffentlichungskopie für Vite (`docs/spielbericht-obersuelzen/index.html`).
